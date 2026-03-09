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
  scoreField?: string;
  scoreMin?: number;
  scoreMax?: number;
};

/**
 * Parse follow-up search syntax on mobile.
 * Supports:
 * - status:green
 * - assignee:john (prefix match by first name)
 * - <scoreName>:>50
 * - <scoreName>:<30
 */
export function parseFollowupQuerySyntax(
  query: string,
  leaderMap: Map<string, LeaderInfo>,
  scoreConfig: ScoreConfigEntry[]
): ParsedFollowupFilters {
  const filters: Omit<ParsedFollowupFilters, "searchText"> = {};
  let freeText = query;

  freeText = freeText.replace(/status:(\w+)/gi, (_, v) => {
    filters.statusFilter = v.toLowerCase();
    return "";
  });

  const reservedKeywords = new Set(["status", "assignee"]);
  freeText = freeText.replace(/(\w+):[<>](\d+)/gi, (match, name, num) => {
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
    if (match.includes("<")) {
      filters.scoreMax = Number(num);
    } else {
      filters.scoreMin = Number(num);
    }
    return "";
  });

  freeText = freeText.replace(/assignee:(\w+)/gi, (match, assigneeName) => {
    let matchedAssignee = false;
    for (const [id, leader] of leaderMap.entries()) {
      if (leader.firstName.toLowerCase().startsWith(assigneeName.toLowerCase())) {
        filters.assigneeFilter = id;
        matchedAssignee = true;
        break;
      }
    }
    return matchedAssignee ? "" : match;
  });

  return { searchText: freeText.trim(), ...filters };
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
