export type ScoreConfigEntry = {
  id: string;
  name: string;
};

export type LeaderInfo = {
  firstName: string;
  lastName: string;
  profilePhoto?: string;
};

export type ParsedFollowupFilters = {
  searchText: string;
  statusFilter?: string;
  assigneeFilter?: string;
  excludedAssigneeFilters: string[];
  scoreField?: string;
  scoreMin?: number;
  scoreMax?: number;
  dateAddedFilter?: {
    operator: "eq" | "lt" | "gt";
    start: number;
    end: number;
    raw: string;
  };
};

export type FollowupSearchSuggestion = {
  id: string;
  label: string;
  insertText: string;
  helperText: string;
};

export function getDateAddedRangeArgs(
  dateAddedFilter?: ParsedFollowupFilters["dateAddedFilter"]
): { addedAtMin?: number; addedAtMax?: number } {
  if (!dateAddedFilter) return {};
  if (dateAddedFilter.operator === "eq") {
    return {
      addedAtMin: dateAddedFilter.start,
      addedAtMax: dateAddedFilter.end,
    };
  }
  if (dateAddedFilter.operator === "lt") {
    return { addedAtMax: dateAddedFilter.start - 1 };
  }
  return { addedAtMin: dateAddedFilter.end + 1 };
}

function parseShortDate(rawDate: string): { start: number; end: number } | null {
  const parts = rawDate.trim().split("/");
  if (parts.length !== 3) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  const yearPart = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(yearPart)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const fullYear = yearPart < 100 ? 2000 + yearPart : yearPart;
  const date = new Date(fullYear, month - 1, day);
  if (
    date.getFullYear() !== fullYear ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  const start = new Date(fullYear, month - 1, day, 0, 0, 0, 0).getTime();
  const end = new Date(fullYear, month - 1, day, 23, 59, 59, 999).getTime();
  return { start, end };
}

function resolveLeaderId(nameQuery: string, leaderMap: Map<string, LeaderInfo>): string | null {
  const normalized = nameQuery.toLowerCase();
  for (const [id, leader] of leaderMap.entries()) {
    const first = leader.firstName.toLowerCase();
    const last = leader.lastName.toLowerCase();
    const full = `${first} ${last}`.trim();
    if (first.startsWith(normalized) || last.startsWith(normalized) || full.startsWith(normalized)) {
      return id;
    }
  }
  return null;
}

/**
 * Parse follow-up search syntax on mobile.
 * Supports:
 * - status:green
 * - assignee:john (prefix match by leader name)
 * - -assignee:john (exclude assignee)
 * - <scoreName>:>50
 * - <scoreName>:<30
 * - date added:12/14/25
 * - date added:<12/14/25
 * - date added:>12/14/25
 */
export function parseFollowupQuerySyntax(
  query: string,
  leaderMap: Map<string, LeaderInfo>,
  scoreConfig: ScoreConfigEntry[]
): ParsedFollowupFilters {
  const filters: Omit<ParsedFollowupFilters, "searchText"> = {
    excludedAssigneeFilters: [],
  };
  let freeText = query;

  freeText = freeText.replace(/status:(\w+)/gi, (_, v) => {
    filters.statusFilter = v.toLowerCase();
    return "";
  });

  const reservedKeywords = new Set(["status", "assignee"]);
  freeText = freeText.replace(/(\w+):([<>])(\d+(?:\.\d+)?)/gi, (match, name, operator, num) => {
    const lowerName = name.toLowerCase();
    if (reservedKeywords.has(lowerName)) {
      return match;
    }

    const scoreIndex = scoreConfig.findIndex((score) =>
      score.name.toLowerCase().startsWith(lowerName)
    );

    if (scoreIndex === -1) {
      return match;
    }

    const matchedField = `score${scoreIndex + 1}`;
    if (filters.scoreField && filters.scoreField !== matchedField) {
      return match;
    }

    filters.scoreField = matchedField;
    if (operator === "<") {
      filters.scoreMax = Number(num);
    } else {
      filters.scoreMin = Number(num);
    }
    return "";
  });

  freeText = freeText.replace(/(-?)assignee:([^\s]+)/gi, (match, negation, assigneeName) => {
    const matchedId = resolveLeaderId(assigneeName, leaderMap);
    if (!matchedId) return match;
    if (negation === "-") {
      filters.excludedAssigneeFilters.push(matchedId);
    } else {
      filters.assigneeFilter = matchedId;
    }
    return "";
  });

  freeText = freeText.replace(
    /(?:date\s*added|addedAt|added):\s*([<>])?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/gi,
    (match, rawOperator, rawDate) => {
      const parsedDate = parseShortDate(rawDate);
      if (!parsedDate) return match;
      const operator = rawOperator === "<" ? "lt" : rawOperator === ">" ? "gt" : "eq";
      filters.dateAddedFilter = {
        operator,
        start: parsedDate.start,
        end: parsedDate.end,
        raw: rawDate,
      };
      return "";
    }
  );

  return { searchText: freeText.replace(/\s+/g, " ").trim(), ...filters };
}

export function applyParsedFollowupFilters<
  T extends { assigneeId?: string; assigneeIds?: string[]; addedAt?: number }
>(items: T[], parsed: ParsedFollowupFilters): T[] {
  if (
    parsed.excludedAssigneeFilters.length === 0 &&
    !parsed.dateAddedFilter
  ) {
    return items;
  }

  return items.filter((item) => {
    const assigneeIds =
      item.assigneeIds && item.assigneeIds.length > 0
        ? item.assigneeIds
        : item.assigneeId
          ? [item.assigneeId]
          : [];
    if (
      parsed.excludedAssigneeFilters.length > 0 &&
      assigneeIds.some((id) => parsed.excludedAssigneeFilters.includes(id))
    ) {
      return false;
    }

    if (parsed.dateAddedFilter) {
      const addedAt = item.addedAt;
      if (!addedAt) return false;
      if (parsed.dateAddedFilter.operator === "eq") {
        return addedAt >= parsed.dateAddedFilter.start && addedAt <= parsed.dateAddedFilter.end;
      }
      if (parsed.dateAddedFilter.operator === "lt") {
        return addedAt < parsed.dateAddedFilter.start;
      }
      return addedAt > parsed.dateAddedFilter.end;
    }

    return true;
  });
}

export function getFollowupSearchSuggestions(
  query: string,
  scoreConfig: ScoreConfigEntry[]
): FollowupSearchSuggestion[] {
  const staticSuggestions: FollowupSearchSuggestion[] = [
    {
      id: "status",
      label: "status:green",
      insertText: "status:green",
      helperText: "Status filter: green, orange, red",
    },
    {
      id: "assignee",
      label: "assignee:seyi",
      insertText: "assignee:",
      helperText: "Filter by one or more assignees",
    },
    {
      id: "exclude-assignee",
      label: "-assignee:bob",
      insertText: "-assignee:",
      helperText: "Exclude one or more assignees",
    },
    {
      id: "date-added-eq",
      label: "date added:12/14/25",
      insertText: "date added:",
      helperText: "Filter by an exact date added",
    },
    {
      id: "date-added-lt",
      label: "date added:<12/14/25",
      insertText: "date added:<",
      helperText: "Members added before a date",
    },
    {
      id: "date-added-gt",
      label: "date added:>12/14/25",
      insertText: "date added:>",
      helperText: "Members added after a date",
    },
  ];

  const scoreSuggestions: FollowupSearchSuggestion[] = scoreConfig.flatMap((score) => {
    const key = score.name.toLowerCase();
    return [
      {
        id: `score-min-${score.id}`,
        label: `${key}:>50`,
        insertText: `${key}:>`,
        helperText: `${score.name} greater than value`,
      },
      {
        id: `score-max-${score.id}`,
        label: `${key}:<50`,
        insertText: `${key}:<`,
        helperText: `${score.name} less than value`,
      },
    ];
  });

  const allSuggestions = [...staticSuggestions, ...scoreSuggestions];
  const trimmed = query.replace(/\s+$/, "");
  const currentFragment = trimmed.slice(trimmed.lastIndexOf(" ") + 1).toLowerCase();
  if (!currentFragment) return allSuggestions.slice(0, 6);

  return allSuggestions
    .filter((suggestion) => {
      const label = suggestion.label.toLowerCase();
      const insertText = suggestion.insertText.toLowerCase();
      return label.startsWith(currentFragment) || insertText.startsWith(currentFragment);
    })
    .slice(0, 6);
}

export function applyFollowupSuggestion(query: string, insertText: string): string {
  const trimmed = query.replace(/\s+$/, "");
  const hasTrailingWhitespace = /\s$/.test(query);
  if (trimmed.length === 0 || hasTrailingWhitespace) {
    return `${trimmed}${trimmed.length ? " " : ""}${insertText}`;
  }

  const lastSpace = trimmed.lastIndexOf(" ");
  const prefix = lastSpace === -1 ? "" : `${trimmed.slice(0, lastSpace + 1)}`;
  return `${prefix}${insertText}`;
}

export function getFollowupQueryHelperText(
  query: string,
  scoreConfig: ScoreConfigEntry[]
): string | null {
  const lower = query.toLowerCase();
  const trimmed = lower.trim();
  if (!trimmed) return null;
  const fragment = trimmed.split(/\s+/).pop() ?? "";

  if (
    lower.includes("assignee:") ||
    fragment.startsWith("assi") ||
    fragment.startsWith("-assi")
  ) {
    return "Use assignee:seyi to include, and -assignee:bob -assignee:sarah to exclude.";
  }
  if (
    /(?:date\s*added|addedat|added):/.test(lower) ||
    fragment.startsWith("date")
  ) {
    return "Date filters: date added:12/14/25, date added:<12/14/25, date added:>12/14/25.";
  }
  if (lower.includes("status:") || fragment.startsWith("status")) {
    return "Status filters: status:green, status:orange, status:red.";
  }
  if (
    scoreConfig.some((score) => {
      const key = score.name.toLowerCase();
      return lower.includes(`${key}:`) || (fragment.length > 0 && key.startsWith(fragment));
    })
  ) {
    return "Score filters support > and < operators, for example attendance:>50.";
  }
  return null;
}

export function chunkIntoPages<T>(items: T[], pageSize: number): T[][] {
  if (items.length === 0) return [[]];
  const safePageSize = Math.max(1, pageSize);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safePageSize) {
    chunks.push(items.slice(i, i + safePageSize));
  }
  return chunks;
}
