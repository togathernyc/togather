import {
  diagnoseMineEmpty,
  mineEmptyCopy,
  myRoleNamesFromCrew,
  planTaskCountsFromAllTeams,
  shouldOfferSharedJump,
  type MineEmptyFacts,
} from "../servingTaskEmptyState";

/** `total` tasks on the plan, `teamLevel` of which belong to whole teams. */
function plan(total: number, teamLevel = 0) {
  return { total, teamLevel };
}

/**
 * Loaded, rostered, task-bearing baseline; each test overrides one fact. The
 * default plan is entirely ROLE-scoped — an all-team-level plan is its own
 * diagnosis (`team-level-only`), not a role mismatch.
 */
function facts(overrides: Partial<MineEmptyFacts> = {}): MineEmptyFacts {
  return {
    planTaskCounts: plan(4),
    myRoleNames: ["Greeter"],
    myTemplateTaskCount: 0,
    sharedTaskCount: 0,
    ...overrides,
  };
}

/** A `getAllTeamsTasks` task row. Empty `roleNames` == team-level. */
function row(taskId: string, roleNames: string[] = ["Greeter"]) {
  return { taskId, roleNames };
}

describe("planTaskCountsFromAllTeams", () => {
  it("returns null while the query is unresolved", () => {
    expect(planTaskCountsFromAllTeams(undefined)).toBeNull();
  });

  it("returns zeroes for a plan with no teams and no tasks", () => {
    expect(planTaskCountsFromAllTeams([])).toEqual(plan(0));
    expect(planTaskCountsFromAllTeams([{ tasks: [] }])).toEqual(plan(0));
  });

  it("counts a multi-team task ONCE (rows are per team, not per task)", () => {
    // `getAllTeamsTasks` lists a task under every team it spans, so summing
    // each team's `taskCount` would over-count. Distinct taskIds is the truth.
    const counts = planTaskCountsFromAllTeams([
      { tasks: [row("t1"), row("t2")] },
      { tasks: [row("t1"), row("t3")] },
    ]);
    expect(counts).toEqual(plan(3));
  });

  // Team-level tasks are counted INTO each team they span, with no roleNames
  // (`eventTasks.ts`'s `roleIds.length === 0` branch). They are part of the
  // total, so the copy needs them told apart from the role-scoped ones.
  it("splits team-level tasks out of the total", () => {
    const counts = planTaskCountsFromAllTeams([
      { tasks: [row("t1", []), row("t2")] },
      { tasks: [row("t1", []), row("t3", [])] },
    ]);
    expect(counts).toEqual(plan(3, 2));
  });

  it("treats a task as role-scoped when ANY team's row names a role", () => {
    // A multi-team ROLE task carries only that team's roles in each row, so a
    // team contributing none of them must not make the whole task team-level.
    const counts = planTaskCountsFromAllTeams([
      { tasks: [row("t1", [])] },
      { tasks: [row("t1", ["Sound"])] },
    ]);
    expect(counts).toEqual(plan(1, 0));
  });
});

/**
 * A `getCrewTasks` row for the viewer. Role ids are team-scoped, so the id is
 * derived from (team, role) — two teams with a "Camera" are two distinct roles.
 */
function crewRow(
  roleName: string,
  team: { teamId: string; teamName: string } = {
    teamId: "team-1",
    teamName: "Hospitality",
  },
) {
  return {
    isCurrentUser: true as boolean,
    roleId: `${team.teamId}:${roleName}`,
    roleName,
    ...team,
  };
}

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
      crewRow("Greeter"),
      { ...crewRow("Camera 1"), isCurrentUser: false },
      crewRow("Usher"),
      crewRow("Greeter"),
    ]);
    expect(names).toEqual(["Greeter", "Usher"]);
  });

  // The de-dupe key used to be the role NAME alone, so two teams that each
  // define a "Camera" collapsed to one entry and the copy said "You're serving
  // as Camera" to someone holding both — understating the roster, which is the
  // very doubt this sentence exists to settle.
  it("keeps a role name held on two different teams as two entries", () => {
    const names = myRoleNamesFromCrew([
      crewRow("Camera", { teamId: "team-prod", teamName: "Production" }),
      crewRow("Camera", { teamId: "team-hosp", teamName: "Hospitality" }),
    ]);
    expect(names).toEqual(["Camera (Production)", "Camera (Hospitality)"]);
  });

  it("leaves unambiguous role names unqualified alongside a colliding one", () => {
    const names = myRoleNamesFromCrew([
      crewRow("Camera", { teamId: "team-prod", teamName: "Production" }),
      crewRow("Camera", { teamId: "team-hosp", teamName: "Hospitality" }),
      crewRow("Greeter", { teamId: "team-hosp", teamName: "Hospitality" }),
    ]);
    expect(names).toEqual([
      "Camera (Production)",
      "Camera (Hospitality)",
      "Greeter",
    ]);
  });

  it("still collapses the SAME role on the same team (a double-written row)", () => {
    const names = myRoleNamesFromCrew([crewRow("Camera"), crewRow("Camera")]);
    expect(names).toEqual(["Camera"]);
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
        facts({ myTemplateTaskCount: 1, planTaskCounts: null, myRoleNames: null }),
      ),
    ).toBe("has-tasks");
  });

  it("loading: refuses to guess while the plan-wide count is unresolved", () => {
    expect(diagnoseMineEmpty(facts({ planTaskCounts: null }))).toBe("loading");
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
    expect(diagnoseMineEmpty(facts({ planTaskCounts: plan(0) }))).toBe(
      "no-plan-tasks",
    );
  });

  it("no-plan-tasks outranks not-rostered when both are true", () => {
    // A freshly created plan is BOTH empty and (often) unrostered. The empty
    // task list is the root cause: fixing the roster would change nothing.
    expect(
      diagnoseMineEmpty(facts({ planTaskCounts: plan(0), myRoleNames: [] })),
    ).toBe("no-plan-tasks");
  });

  it("not-rostered: tasks exist but the viewer holds no role on the plan", () => {
    expect(diagnoseMineEmpty(facts({ myRoleNames: [] }))).toBe("not-rostered");
  });

  it("role-mismatch: tasks exist, the viewer has roles, none match", () => {
    expect(diagnoseMineEmpty(facts())).toBe("role-mismatch");
  });

  // Was `role-mismatch`, which then told the viewer the tasks were "for other
  // roles" — false: a team-level task is for the viewer's OWN team, which the
  // very next sentence ("Shared has 3 tasks for your whole team") said out loud.
  it("team-level-only: every task on the plan belongs to a whole team", () => {
    // Every task is team-level, so `getMyServingTasks` returns none while
    // `getSharedTeamTasks` returns them all.
    expect(
      diagnoseMineEmpty(facts({ planTaskCounts: plan(3, 3), sharedTaskCount: 3 })),
    ).toBe("team-level-only");
  });

  it("role-mismatch still wins when only SOME of the plan is team-level", () => {
    expect(diagnoseMineEmpty(facts({ planTaskCounts: plan(3, 2) }))).toBe(
      "role-mismatch",
    );
  });

  // The team-level-only copy points at "Shared", which is empty for someone
  // holding no role on any team here — so the rostering gap is the better story.
  it("not-rostered outranks team-level-only", () => {
    expect(
      diagnoseMineEmpty(facts({ planTaskCounts: plan(3, 3), myRoleNames: [] })),
    ).toBe("not-rostered");
  });
});

describe("mineEmptyCopy", () => {
  it("renders no notice for has-tasks or loading", () => {
    expect(mineEmptyCopy("has-tasks", facts())).toBeNull();
    expect(mineEmptyCopy("loading", facts())).toBeNull();
  });

  it("no-plan-tasks does NOT blame the team lead's configuration", () => {
    const copy = mineEmptyCopy("no-plan-tasks", facts({ planTaskCounts: plan(0) }))!;
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
      facts({ planTaskCounts: plan(7), myRoleNames: [] }),
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
      facts({ planTaskCounts: plan(5), myRoleNames: ["Greeter", "Usher"] }),
    )!;
    expect(copy.title).toBe(
      "None of this event's tasks are assigned to your roles.",
    );
    expect(copy.hint).toContain("You're serving as Greeter and Usher.");
    expect(copy.hint).toContain(
      "This event's 5 tasks — across all teams — are for other roles.",
    );
    expect(copy.hint).toContain("Ask your team lead to add tasks for your roles.");
  });

  it("role-mismatch uses the singular for one task and one role", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCounts: plan(1), myRoleNames: ["Greeter"] }),
    )!;
    expect(copy.title).toBe(
      "None of this event's tasks are assigned to your role.",
    );
    expect(copy.hint).toContain("You're serving as Greeter.");
    expect(copy.hint).toContain(
      "This event's 1 task — across all teams — is for another role.",
    );
    expect(copy.hint).toContain("Ask your team lead to add tasks for your role.");
  });

  // Shipped in #702 and seen live: "You're serving as Camera. Its 2 tasks —
  // across all teams — are for other roles." "Its" attaches to the role named
  // immediately before it, so it read as "Camera's 2 tasks are for other
  // roles" — self-contradictory. The subject is the EVENT, and it must be
  // spelled out; there is no arity of the role list at which "Its" is safe.
  // (The plan here is entirely ROLE-scoped, which is the only shape for which
  // "are for other roles" is a true sentence — see the team-level cases below.)
  it("never lets the plan-wide count read as the viewer's role's own tasks", () => {
    for (const myRoleNames of [
      ["Camera"],
      ["Camera", "Usher"],
      ["Camera", "Usher", "Greeter"],
    ]) {
      const copy = mineEmptyCopy(
        "role-mismatch",
        facts({ planTaskCounts: plan(2), myRoleNames }),
      )!;
      expect(copy.hint).toContain(
        "This event's 2 tasks — across all teams — are for other roles.",
      );
      expect(copy.hint).not.toContain("Its ");
    }
  });

  // The reporter's real data: planTaskCount 2, roles ["Camera"], shared 2 — the
  // two tasks were TEAM-level, so the old copy said "This event's 2 tasks —
  // across all teams — are for other roles." one sentence before "Shared has 2
  // tasks for your whole team." Both cannot be true of the same two tasks.
  it("never calls team-level tasks 'for other roles'", () => {
    const copy = mineEmptyCopy(
      "team-level-only",
      facts({
        planTaskCounts: plan(2, 2),
        myRoleNames: ["Camera"],
        sharedTaskCount: 2,
      }),
    )!;
    expect(copy.hint).not.toContain("for other roles");
    expect(copy.hint).not.toContain("for another role");
    expect(copy.title).toBe("This event's tasks are for whole teams, not roles.");
    expect(copy.hint).toContain("You're serving as Camera.");
    expect(copy.hint).toContain(
      "All 2 of this event's tasks are for whole teams rather than single roles, so none of them are in Mine.",
    );
    expect(copy.hint).toContain("Shared has 2 tasks for your whole team.");
    // Nobody is at fault here, so nobody is asked to fix anything.
    expect(copy.hint).not.toContain("Ask your team lead");
  });

  it("uses the singular when the whole plan is one team-level task", () => {
    const copy = mineEmptyCopy(
      "team-level-only",
      facts({ planTaskCounts: plan(1, 1), sharedTaskCount: 1 }),
    )!;
    expect(copy.hint).toContain(
      "This event's only task is for a whole team rather than a single role, so it isn't in Mine.",
    );
  });

  // Some role-scoped, some team-level: the sentence may claim only the
  // role-scoped ones are for other roles, and must account for the rest.
  it("role-mismatch splits a mixed plan instead of claiming all N are for other roles", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCounts: plan(5, 2), myRoleNames: ["Camera"] }),
    )!;
    expect(copy.hint).toContain(
      "Of this event's 5 tasks — across all teams — 3 are for other roles and 2 are for whole teams.",
    );
    expect(copy.hint).not.toContain("This event's 5 tasks — across all teams —");
  });

  it("uses singulars on each side of a mixed plan's split", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCounts: plan(2, 1), myRoleNames: ["Camera"] }),
    )!;
    expect(copy.hint).toContain(
      "Of this event's 2 tasks — across all teams — 1 is for another role and 1 is for a whole team.",
    );
  });

  // The all-role-scoped plan keeps the plainer sentence — there is no team-level
  // remainder to account for.
  it("role-mismatch keeps the simple sentence when nothing is team-level", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCounts: plan(3, 0), myRoleNames: ["Camera"] }),
    )!;
    expect(copy.hint).toContain(
      "This event's 3 tasks — across all teams — are for other roles.",
    );
    expect(copy.hint).not.toContain("Of this event's");
  });

  it("role-mismatch points at Shared when the team has shared tasks", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCounts: plan(5), sharedTaskCount: 3 }),
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

  // `myRoleNamesFromCrew` returns EVERY role the viewer holds, so the copy has
  // to name all of them — someone rostered for three things who is told
  // "You're serving as Camera" reasonably doubts the whole message.
  it.each([
    [["Camera 1"], "Camera 1", "role"],
    [["Camera 1", "Usher"], "Camera 1 and Usher", "roles"],
    [["Camera 1", "Usher", "Greeter"], "Camera 1, Usher and Greeter", "roles"],
    [
      ["Camera 1", "Usher", "Greeter", "Drums"],
      "Camera 1, Usher, Greeter and Drums",
      "roles",
    ],
  ])("names all %# roles the viewer holds", (myRoleNames, joined, roleWord) => {
    const copy = mineEmptyCopy("role-mismatch", facts({ myRoleNames }))!;
    expect(copy.hint).toContain(`You're serving as ${joined}.`);
    expect(copy.title).toBe(
      `None of this event's tasks are assigned to your ${roleWord}.`,
    );
    expect(copy.hint).toContain(
      `Ask your team lead to add tasks for your ${roleWord}.`,
    );
    for (const name of myRoleNames) expect(copy.hint).toContain(name);
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
        facts({ planTaskCounts: plan(0), sharedTaskCount: 2 }),
      ),
    ).toBe(false);
  });

  it("offers the jump when the whole plan is team-level (Shared holds it all)", () => {
    expect(
      shouldOfferSharedJump(
        "team-level-only",
        facts({ planTaskCounts: plan(3, 3), sharedTaskCount: 3 }),
      ),
    ).toBe(true);
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
