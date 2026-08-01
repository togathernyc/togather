import {
  buildRoleCatalog,
  canAuthorPlanTasks,
  isTeamLevelTask,
  roleTaskCounts,
  tasksForRole,
  type AuthorableTask,
} from "../taskAuthoring";

describe("canAuthorPlanTasks", () => {
  it("allows an active group leader", () => {
    expect(canAuthorPlanTasks("leader", false)).toBe(true);
  });

  it("allows a group role literally called admin", () => {
    // Matches the desktop grid's identical check (EventTasksScreen's
    // `isLeader`) — kept consistent rather than reinvented.
    expect(canAuthorPlanTasks("admin", false)).toBe(true);
  });

  it("allows a community admin regardless of their group role", () => {
    expect(canAuthorPlanTasks("member", true)).toBe(true);
    expect(canAuthorPlanTasks(undefined, true)).toBe(true);
    expect(canAuthorPlanTasks(null, true)).toBe(true);
  });

  // The backend gate these mutations actually use (`isGroupScheduler`) does
  // NOT grant team managers or team-channel admins/moderators — that's the
  // wider `isTeamScheduler` used elsewhere in scheduling. A team manager (or
  // any other plain group member) who isn't also a group leader or community
  // admin must not see the authoring affordance, since the mutation would
  // reject them.
  it("excludes a plain member (including a team manager, who is not a group leader)", () => {
    expect(canAuthorPlanTasks("member", false)).toBe(false);
  });

  it("excludes someone with no group membership at all", () => {
    expect(canAuthorPlanTasks(undefined, false)).toBe(false);
    expect(canAuthorPlanTasks(null, false)).toBe(false);
  });
});

describe("tasksForRole", () => {
  const TEAM_1 = { roleId: "role-a", teamId: "team-1" };
  const TEAM_1_B = { roleId: "role-b", teamId: "team-1" };

  const tasks: AuthorableTask[] = [
    { teamIds: ["team-1"], roleIds: ["role-a"], segment: "before", sortOrder: 1 },
    { teamIds: ["team-1"], roleIds: ["role-a"], segment: "before", sortOrder: 0 },
    {
      teamIds: ["team-1"],
      roleIds: ["role-a", "role-b"],
      segment: "during",
      sortOrder: 0,
    },
    { teamIds: ["team-1"], roleIds: ["role-b"], segment: "after", sortOrder: 0 },
    { teamIds: ["team-1"], roleIds: [], segment: "before", sortOrder: 2 }, // team-level
  ];

  it("returns the selected role's tasks (plus its team's team-level), sorted by sortOrder", () => {
    const result = tasksForRole(tasks, TEAM_1);
    expect(result.before.map((t) => t.sortOrder)).toEqual([0, 1, 2]);
    expect(result.during).toHaveLength(1);
    expect(result.after).toHaveLength(0);
  });

  it("includes a multi-role task under every role it lists", () => {
    const a = tasksForRole(tasks, TEAM_1);
    const b = tasksForRole(tasks, TEAM_1_B);
    expect(a.during).toHaveLength(1);
    expect(b.during).toHaveLength(1);
    expect(a.during[0]).toBe(b.during[0]);
  });

  // Team-level tasks used to be filtered out here, which made the Edit surface
  // the one place a leader could neither see nor fix them (they're excluded
  // from "Mine" by design and live only under the read-only Shared pill). The
  // UI labels them as whole-team so the role context stays honest.
  it("includes team-level tasks (empty roleIds) under every role on that team", () => {
    const a = tasksForRole(tasks, TEAM_1);
    const b = tasksForRole(tasks, TEAM_1_B);
    expect(a.before.filter(isTeamLevelTask)).toHaveLength(1);
    expect(b.before.filter(isTeamLevelTask)).toHaveLength(1);
  });

  it("returns all-empty buckets when no role is selected", () => {
    const result = tasksForRole(tasks, null);
    expect(result).toEqual({ before: [], during: [], after: [] });
  });

  it("still surfaces team-level tasks for a role with no tasks of its own", () => {
    const result = tasksForRole(tasks, { roleId: "role-nobody", teamId: "team-1" });
    expect(result.before).toHaveLength(1);
    expect(result.before[0].roleIds).toEqual([]);
    expect(result.during).toEqual([]);
    expect(result.after).toEqual([]);
  });

  // REGRESSION: `listPlanTasks` is PLAN-wide (every team) and the role catalog
  // spans every team in the group, so a team-level task used to leak into
  // another team's Edit list — captioned "Whole team", one tap from Delete.
  describe("across teams", () => {
    const multiTeam: AuthorableTask[] = [
      // Worship's whole-team task.
      { teamIds: ["team-worship"], roleIds: [], segment: "before", sortOrder: 0 },
      // Kids' whole-team task.
      { teamIds: ["team-kids"], roleIds: [], segment: "before", sortOrder: 1 },
      // A task shared by both teams.
      {
        teamIds: ["team-worship", "team-kids"],
        roleIds: [],
        segment: "during",
        sortOrder: 0,
      },
    ];

    it("never shows another team's team-level task", () => {
      const kids = tasksForRole(multiTeam, {
        roleId: "role-checkin",
        teamId: "team-kids",
      });
      expect(kids.before).toHaveLength(1);
      expect(kids.before[0].teamIds).toEqual(["team-kids"]);

      const worship = tasksForRole(multiTeam, {
        roleId: "role-sound",
        teamId: "team-worship",
      });
      expect(worship.before).toHaveLength(1);
      expect(worship.before[0].teamIds).toEqual(["team-worship"]);
    });

    it("shows a task spanning both teams to each of them", () => {
      const kids = tasksForRole(multiTeam, {
        roleId: "role-checkin",
        teamId: "team-kids",
      });
      const worship = tasksForRole(multiTeam, {
        roleId: "role-sound",
        teamId: "team-worship",
      });
      expect(kids.during).toHaveLength(1);
      expect(worship.during).toHaveLength(1);
      expect(kids.during[0]).toBe(worship.during[0]);
    });

    it("shows nothing team-level to a team that owns none", () => {
      const other = tasksForRole(multiTeam, {
        roleId: "role-usher",
        teamId: "team-hospitality",
      });
      expect(other).toEqual({ before: [], during: [], after: [] });
    });
  });
});

describe("isTeamLevelTask", () => {
  it("is true only when the task names no role", () => {
    expect(
      isTeamLevelTask({
        teamIds: ["team-1"],
        roleIds: [],
        segment: "before",
        sortOrder: 0,
      }),
    ).toBe(true);
    expect(
      isTeamLevelTask({
        teamIds: ["team-1"],
        roleIds: ["role-a"],
        segment: "before",
        sortOrder: 0,
      }),
    ).toBe(false);
  });
});

describe("buildRoleCatalog", () => {
  it("flattens teams + per-team roles, sorted by team then role name", () => {
    const teams = [
      { _id: "team-2", name: "Worship" },
      { _id: "team-1", name: "Hospitality" },
    ];
    const rolesByTeam = {
      "team-2": [
        { _id: "role-drums", name: "Drums" },
        { _id: "role-vox", name: "Vocals" },
      ],
      "team-1": [{ _id: "role-greeter", name: "Greeter" }],
    };
    expect(buildRoleCatalog(teams, rolesByTeam)).toEqual([
      { roleId: "role-greeter", roleName: "Greeter", teamId: "team-1", teamName: "Hospitality" },
      { roleId: "role-drums", roleName: "Drums", teamId: "team-2", teamName: "Worship" },
      { roleId: "role-vox", roleName: "Vocals", teamId: "team-2", teamName: "Worship" },
    ]);
  });

  it("contributes nothing for a team whose roles haven't loaded yet", () => {
    const teams = [{ _id: "team-1", name: "Hospitality" }];
    expect(buildRoleCatalog(teams, {})).toEqual([]);
  });

  it("returns an empty catalog for no teams", () => {
    expect(buildRoleCatalog([], {})).toEqual([]);
  });
});

describe("roleTaskCounts", () => {
  const catalog = [
    { roleId: "role-a" },
    { roleId: "role-b" },
    { roleId: "role-c" },
  ];

  it("counts each role's OWN tasks and gives an unauthored role 0", () => {
    const tasks: AuthorableTask[] = [
      { teamIds: ["team-1"], roleIds: ["role-a"], segment: "before", sortOrder: 0 },
      { teamIds: ["team-1"], roleIds: ["role-a"], segment: "after", sortOrder: 1 },
      { teamIds: ["team-1"], roleIds: ["role-b"], segment: "during", sortOrder: 0 },
    ];
    expect(roleTaskCounts(tasks, catalog)).toEqual({
      "role-a": 2,
      "role-b": 1,
      "role-c": 0,
    });
  });

  // The badge exists to make a gap visible. `tasksForRole` folds a team's
  // team-level tasks into EVERY role on that team, so counting its output
  // would put "1" on all four Worship roles and hide the very gap a manager is
  // scanning for. Team-level tasks stay visible (captioned "Whole team") in
  // the body — they just don't inflate the badge.
  it("excludes team-level tasks, unlike tasksForRole", () => {
    const tasks: AuthorableTask[] = [
      { teamIds: ["team-1"], roleIds: [], segment: "before", sortOrder: 0 },
      { teamIds: ["team-1"], roleIds: ["role-a"], segment: "before", sortOrder: 1 },
    ];
    expect(roleTaskCounts(tasks, catalog)).toEqual({
      "role-a": 1,
      "role-b": 0,
      "role-c": 0,
    });
    // The body list for role-b is NOT empty — it shows the team-level task —
    // which is exactly why the badge must not reuse this number.
    expect(
      tasksForRole(tasks, { roleId: "role-b", teamId: "team-1" }).before,
    ).toHaveLength(1);
  });

  it("counts a multi-role task once for each role it names", () => {
    const tasks: AuthorableTask[] = [
      {
        teamIds: ["team-1"],
        roleIds: ["role-a", "role-b"],
        segment: "during",
        sortOrder: 0,
      },
    ];
    expect(roleTaskCounts(tasks, catalog)).toEqual({
      "role-a": 1,
      "role-b": 1,
      "role-c": 0,
    });
  });

  it("ignores roles outside the catalog (another team's roles may not have loaded)", () => {
    const tasks: AuthorableTask[] = [
      { teamIds: ["team-2"], roleIds: ["role-z"], segment: "before", sortOrder: 0 },
    ];
    expect(roleTaskCounts(tasks, catalog)).toEqual({
      "role-a": 0,
      "role-b": 0,
      "role-c": 0,
    });
  });

  it("returns an entry per catalog role for an empty plan, and {} for an empty catalog", () => {
    expect(roleTaskCounts([], catalog)).toEqual({
      "role-a": 0,
      "role-b": 0,
      "role-c": 0,
    });
    expect(roleTaskCounts([], [])).toEqual({});
  });
});
