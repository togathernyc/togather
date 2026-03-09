import {
  chunkIntoPages,
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
