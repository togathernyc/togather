import {
  distinctRolePairs,
  formatSharedTaskTeams,
  formatTaskProvenance,
  heldRolePairs,
  planSubtitle,
  shouldShowTaskProvenance,
  shouldShowTeamNames,
  type RolePair,
} from "../servingProvenance";

/** A (team, role) the viewer holds. Role ids are team-scoped. */
function pair(
  roleName: string,
  teamName = "Hospitality",
  teamId = "team-hosp",
): RolePair {
  return { roleId: `${teamId}:${roleName}`, roleName, teamId, teamName };
}

const CAMERA_PROD = pair("Camera", "Production", "team-prod");
const SOUND_PROD = pair("Sound", "Production", "team-prod");
const GREETER_HOSP = pair("Greeter");
/** Same NAME as CAMERA_PROD, different team — the collision that must survive. */
const CAMERA_HOSP = pair("Camera");

describe("planSubtitle", () => {
  it("is null with no group name — nothing empty should render", () => {
    expect(planSubtitle(undefined)).toBeNull();
    expect(planSubtitle("")).toBeNull();
    expect(planSubtitle("   ")).toBeNull();
  });

  it("names the group that rostered the viewer", () => {
    expect(planSubtitle("FOUNT Brooklyn")).toBe("FOUNT Brooklyn");
  });

  it("appends the viewer's teams on that plan when known", () => {
    expect(planSubtitle("FOUNT Brooklyn", ["Production", "Hospitality"])).toBe(
      "FOUNT Brooklyn · Production, Hospitality",
    );
  });

  it("ignores empty team names rather than trailing a separator", () => {
    expect(planSubtitle("FOUNT Brooklyn", ["", ""])).toBe("FOUNT Brooklyn");
  });
});

describe("distinctRolePairs", () => {
  it("keeps first-seen order and drops exact repeats", () => {
    expect(
      distinctRolePairs([CAMERA_PROD, GREETER_HOSP, CAMERA_PROD]),
    ).toEqual([CAMERA_PROD, GREETER_HOSP]);
  });

  it("does NOT collapse the same role name on two different teams", () => {
    expect(distinctRolePairs([CAMERA_PROD, CAMERA_HOSP])).toHaveLength(2);
  });
});

describe("heldRolePairs", () => {
  it("is null — not empty — while the crew rows are unresolved", () => {
    // The distinction is the whole point: `[]` would mean "holds nothing" and
    // is a decision; `null` means "don't decide yet".
    expect(heldRolePairs(undefined)).toBeNull();
  });

  it("keeps only the viewer's own crew rows", () => {
    const crew = [
      { ...CAMERA_PROD, isCurrentUser: true },
      { ...SOUND_PROD, isCurrentUser: false },
    ];
    expect(heldRolePairs(crew)).toEqual([CAMERA_PROD]);
  });

  it("reports every role the viewer holds, including task-less ones", () => {
    // getCrewTasks emits a row per (member, role) even when that role has zero
    // tasks on the plan — which is why it, and not the task rows, is the source.
    const crew = [
      { ...CAMERA_PROD, isCurrentUser: true },
      { ...GREETER_HOSP, isCurrentUser: true },
    ];
    expect(heldRolePairs(crew)).toEqual([CAMERA_PROD, GREETER_HOSP]);
  });
});

describe("shouldShowTaskProvenance / shouldShowTeamNames", () => {
  it("says nothing for the single-role volunteer", () => {
    expect(shouldShowTaskProvenance([CAMERA_PROD])).toBe(false);
    expect(shouldShowTaskProvenance([])).toBe(false);
  });

  it("says nothing while the crew rows are unresolved", () => {
    // Otherwise the labels pop in when the second subscription lands and reflow
    // every row of a checklist whose rows are tap targets — and offline, where
    // "crew" may never have been cached, they would stay wrongly absent.
    expect(shouldShowTaskProvenance(null)).toBe(false);
    expect(shouldShowTeamNames(null)).toBe(false);
  });

  it("labels rows once the viewer holds two pairs", () => {
    expect(shouldShowTaskProvenance([CAMERA_PROD, SOUND_PROD])).toBe(true);
  });

  it("omits team names while the viewer is on one team", () => {
    expect(shouldShowTeamNames([CAMERA_PROD, SOUND_PROD])).toBe(false);
  });

  it("names teams once the viewer spans two", () => {
    expect(shouldShowTeamNames([CAMERA_PROD, GREETER_HOSP])).toBe(true);
  });
});

describe("formatTaskProvenance", () => {
  it("is null when the task matched no role of the viewer's (personal task)", () => {
    expect(formatTaskProvenance([], false)).toBeNull();
    expect(formatTaskProvenance(undefined, true)).toBeNull();
  });

  it("names just the role when the viewer is on one team", () => {
    expect(formatTaskProvenance([CAMERA_PROD], false)).toBe("Camera");
  });

  it("names every role a task matched, not just the first", () => {
    // `roleIds` is an array, so one task can be the viewer's twice over.
    // Showing only the first would recreate the doubt this exists to remove.
    expect(formatTaskProvenance([CAMERA_PROD, SOUND_PROD], false)).toBe(
      "Camera & Sound",
    );
  });

  it("leads with the team when the viewer spans several", () => {
    expect(formatTaskProvenance([CAMERA_PROD], true)).toBe(
      "Production · Camera",
    );
  });

  it("groups multiple matches under their teams", () => {
    expect(
      formatTaskProvenance([CAMERA_PROD, SOUND_PROD, GREETER_HOSP], true),
    ).toBe("Production · Camera & Sound, Hospitality · Greeter");
  });

  it("tells two same-named roles on different teams apart", () => {
    expect(formatTaskProvenance([CAMERA_PROD, CAMERA_HOSP], true)).toBe(
      "Production · Camera, Hospitality · Camera",
    );
  });
});

describe("formatSharedTaskTeams", () => {
  it("is null while the viewer is on a single team — 'Team task' is enough", () => {
    expect(formatSharedTaskTeams(["Production"], [CAMERA_PROD])).toBeNull();
    expect(
      formatSharedTaskTeams(["Production"], [CAMERA_PROD, SOUND_PROD]),
    ).toBeNull();
  });

  it("names the task's own team once the viewer is on more than one", () => {
    expect(
      formatSharedTaskTeams(["Production"], [CAMERA_PROD, GREETER_HOSP]),
    ).toBe("Production");
  });

  it("names every team a multi-team shared task spans", () => {
    expect(
      formatSharedTaskTeams(
        ["Production", "Hospitality"],
        [CAMERA_PROD, GREETER_HOSP],
      ),
    ).toBe("Production, Hospitality");
  });

  it("is null while the crew rows are unresolved — plain 'Team task' stands", () => {
    expect(formatSharedTaskTeams(["Production"], null)).toBeNull();
  });

  it("is null when the task carries no team names at all", () => {
    expect(formatSharedTaskTeams([], [CAMERA_PROD, GREETER_HOSP])).toBeNull();
    expect(
      formatSharedTaskTeams(undefined, [CAMERA_PROD, GREETER_HOSP]),
    ).toBeNull();
  });
});
