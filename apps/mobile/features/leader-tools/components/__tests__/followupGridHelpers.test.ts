import {
  applyParsedFollowupFilters,
  applyFollowupSuggestion,
  chunkIntoPages,
  getDateAddedRangeArgs,
  getFollowupQueryHelperText,
  getFollowupSearchSuggestions,
  parseFollowupQuerySyntax,
  type LeaderInfo,
  type ScoreConfigEntry,
} from "../followupGridHelpers";

describe("parseFollowupQuerySyntax", () => {
  const leaders = new Map<string, LeaderInfo>([
    ["leader-1", { firstName: "John", lastName: "Doe" }],
    ["leader-2", { firstName: "Sarah", lastName: "Lee" }],
  ]);

  const scoreConfig: ScoreConfigEntry[] = [
    { id: "attendance", name: "Attendance" },
    { id: "connection", name: "Connection" },
  ];

  it("parses structured filters and keeps remaining free text", () => {
    const parsed = parseFollowupQuerySyntax(
      "status:green assignee:sa attendance:>50 looking for no-shows",
      leaders,
      scoreConfig
    );

    expect(parsed.statusFilter).toBe("green");
    expect(parsed.assigneeFilter).toBe("leader-2");
    expect(parsed.scoreField).toBe("score1");
    expect(parsed.scoreMin).toBe(50);
    expect(parsed.searchText).toBe("looking for no-shows");
  });

  it("supports score ranges on the same score field", () => {
    const parsed = parseFollowupQuerySyntax(
      "attendance:>20 attendance:<80",
      leaders,
      scoreConfig
    );

    expect(parsed.scoreField).toBe("score1");
    expect(parsed.scoreMin).toBe(20);
    expect(parsed.scoreMax).toBe(80);
    expect(parsed.searchText).toBe("");
  });

  it("ignores a second score range token targeting another score field", () => {
    const parsed = parseFollowupQuerySyntax(
      "attendance:>20 connection:<40",
      leaders,
      scoreConfig
    );

    expect(parsed.scoreField).toBe("score1");
    expect(parsed.scoreMin).toBe(20);
    expect(parsed.scoreMax).toBeUndefined();
    expect(parsed.searchText).toContain("connection:<40");
  });

  it("keeps unknown assignee tokens in free text", () => {
    const parsed = parseFollowupQuerySyntax(
      "assignee:unknown status:green",
      leaders,
      scoreConfig
    );

    expect(parsed.statusFilter).toBe("green");
    expect(parsed.assigneeFilter).toBeUndefined();
    expect(parsed.searchText).toBe("assignee:unknown");
  });

  it("supports negative assignee filters", () => {
    const parsed = parseFollowupQuerySyntax(
      "attendance:>40 -assignee:sa -assignee:jo",
      leaders,
      scoreConfig
    );

    expect(parsed.scoreField).toBe("score1");
    expect(parsed.excludedAssigneeFilters).toEqual(["leader-2", "leader-1"]);
    expect(parsed.searchText).toBe("");
  });

  it("parses date added operators", () => {
    const parsed = parseFollowupQuerySyntax(
      "date added:<12/14/25 followup",
      leaders,
      scoreConfig
    );
    expect(parsed.dateAddedFilter?.operator).toBe("lt");
    expect(parsed.dateAddedFilter?.raw).toBe("12/14/25");
    expect(parsed.searchText).toBe("followup");
  });
});

describe("applyParsedFollowupFilters", () => {
  const baseMembers = [
    { assigneeId: "leader-1", assigneeIds: ["leader-1", "leader-2"], addedAt: new Date(2025, 11, 13, 12).getTime() },
    { assigneeId: "leader-2", addedAt: new Date(2025, 11, 14, 12).getTime() },
    { assigneeId: "leader-2", addedAt: new Date(2025, 11, 15, 12).getTime() },
  ];

  it("removes excluded assignees", () => {
    const parsed = {
      searchText: "",
      excludedAssigneeFilters: ["leader-2"],
    };
    const filtered = applyParsedFollowupFilters(baseMembers, parsed);
    expect(filtered).toHaveLength(0);
  });

  it("applies exact date filter", () => {
    const parsed = {
      searchText: "",
      excludedAssigneeFilters: [],
      dateAddedFilter: {
        operator: "eq" as const,
        start: new Date(2025, 11, 14, 0, 0, 0, 0).getTime(),
        end: new Date(2025, 11, 14, 23, 59, 59, 999).getTime(),
        raw: "12/14/25",
      },
    };
    const filtered = applyParsedFollowupFilters(baseMembers, parsed);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].addedAt).toBe(baseMembers[1].addedAt);
  });
});

describe("getDateAddedRangeArgs", () => {
  it("maps eq operator to day bounds", () => {
    const range = getDateAddedRangeArgs({
      operator: "eq",
      start: 100,
      end: 199,
      raw: "12/14/25",
    });
    expect(range).toEqual({ addedAtMin: 100, addedAtMax: 199 });
  });

  it("maps lt and gt operators to exclusive bounds", () => {
    expect(
      getDateAddedRangeArgs({ operator: "lt", start: 300, end: 399, raw: "12/14/25" })
    ).toEqual({ addedAtMax: 299 });
    expect(
      getDateAddedRangeArgs({ operator: "gt", start: 300, end: 399, raw: "12/14/25" })
    ).toEqual({ addedAtMin: 400 });
  });
});

describe("search suggestions", () => {
  const scoreConfig: ScoreConfigEntry[] = [
    { id: "attendance", name: "Attendance" },
    { id: "connection", name: "Connection" },
  ];

  it("returns assignee suggestions for partial input", () => {
    const suggestions = getFollowupSearchSuggestions("assi", scoreConfig);
    expect(suggestions.some((s) => s.insertText.startsWith("assignee:"))).toBe(true);
  });

  it("replaces active token when applying suggestion", () => {
    expect(applyFollowupSuggestion("status:green assi", "assignee:")).toBe(
      "status:green assignee:"
    );
  });

  it("returns contextual helper text", () => {
    expect(getFollowupQueryHelperText("date added:", scoreConfig)).toContain("Date filters");
  });

  it("returns null helper text for empty query", () => {
    expect(getFollowupQueryHelperText("", scoreConfig)).toBeNull();
  });
});

describe("chunkIntoPages", () => {
  it("splits items into fixed-size pages", () => {
    expect(chunkIntoPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single empty page for empty input", () => {
    expect(chunkIntoPages([], 3)).toEqual([[]]);
  });

  it("guards against invalid page sizes", () => {
    expect(chunkIntoPages(["a", "b", "c"], 0)).toEqual([["a"], ["b"], ["c"]]);
  });
});
