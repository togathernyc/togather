import type { CustomFieldDef } from "./ColumnPickerModal";
import { parseMultiSelectValues } from "./followupSelectFields";
import { SYSTEM_SCORE_COLUMNS } from "./followupShared";
import type { LeaderInfo } from "./followupGridHelpers";

function escapeCSVField(field: string | number | null | undefined): string {
  if (field === null || field === undefined) {
    return "";
  }
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCSV(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const headerLine = headers.map(escapeCSVField).join(",");
  const dataLines = rows.map((row) => row.map(escapeCSVField).join(","));
  return [headerLine, ...dataLines].join("\n");
}

export type FollowupCsvExportMember = {
  userId: string;
  groupMemberId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  zipCode?: string;
  dateOfBirth?: number;
  latestNote?: string;
  score1: number;
  score2: number;
  score3?: number;
  status?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  lastAttendedAt?: number;
  lastFollowupAt?: number;
  lastActiveAt?: number;
  addedAt?: number;
  alerts?: string[];
  customText1?: string;
  customText2?: string;
  customText3?: string;
  customText4?: string;
  customText5?: string;
  customNum1?: number;
  customNum2?: number;
  customNum3?: number;
  customNum4?: number;
  customNum5?: number;
  customBool1?: boolean;
  customBool2?: boolean;
  customBool3?: boolean;
  customBool4?: boolean;
  customBool5?: boolean;
};

export type FollowupCsvExportTask = {
  title: string;
  assignedToName?: string;
  groupName?: string;
};

function formatTimestampMs(ts: number | undefined): string {
  if (ts === undefined) return "";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatBirthdayUtc(ts: number | undefined): string {
  if (ts === undefined) return "";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getAssigneeIds(member: FollowupCsvExportMember): string[] {
  const ids =
    member.assigneeIds && member.assigneeIds.length > 0
      ? member.assigneeIds
      : member.assigneeId
        ? [member.assigneeId]
        : [];
  return Array.from(new Set(ids));
}

function formatAssigneeNames(
  member: FollowupCsvExportMember,
  leaderMap: Map<string, LeaderInfo>,
): string {
  return getAssigneeIds(member)
    .map((id) => {
      const l = leaderMap.get(id);
      if (!l) return "";
      return `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim();
    })
    .filter(Boolean)
    .join("; ");
}

function formatTasksForExport(tasks: FollowupCsvExportTask[]): string {
  if (!tasks.length) return "";
  return tasks
    .map((t) => {
      const who = t.assignedToName ?? "Unassigned";
      const where = t.groupName ? ` [${t.groupName}]` : "";
      return `${who} — ${t.title}${where}`;
    })
    .join(" | ");
}

const SCORE_SLOT_TO_NAME: Record<string, string> = Object.fromEntries(
  SYSTEM_SCORE_COLUMNS.map((sc) => [sc.slot, sc.name]),
);

function customFieldTypeForSlot(
  slot: string,
  customFields: CustomFieldDef[],
): CustomFieldDef["type"] | undefined {
  return customFields.find((f) => f.slot === slot)?.type;
}

function formatCustomSlotValue(
  member: FollowupCsvExportMember,
  slot: string,
  customFields: CustomFieldDef[],
): string {
  const raw = (member as Record<string, unknown>)[slot];
  if (raw === undefined || raw === null) return "";

  const type = customFieldTypeForSlot(slot, customFields);
  if (type === "boolean") {
    return raw === true ? "true" : raw === false ? "false" : "";
  }
  if (type === "number") {
    return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : String(raw);
  }
  if (type === "multiselect") {
    const str = String(raw).trim();
    if (!str) return "";
    return parseMultiSelectValues(str).join("; ");
  }
  return String(raw).trim();
}

export function cellValueForColumn(
  colKey: string,
  member: FollowupCsvExportMember,
  ctx: {
    leaderMap: Map<string, LeaderInfo>;
    tasksByMember: Map<string, FollowupCsvExportTask[]>;
    customFields: CustomFieldDef[];
  },
): string {
  const { leaderMap, tasksByMember, customFields } = ctx;

  switch (colKey) {
    case "addedAt":
      return formatTimestampMs(member.addedAt);
    case "firstName":
      return member.firstName ?? "";
    case "lastName":
      return member.lastName ?? "";
    case "email":
      return member.email ?? "";
    case "phone":
      return member.phone ?? "";
    case "zipCode":
      return member.zipCode ?? "";
    case "dateOfBirth":
      return formatBirthdayUtc(member.dateOfBirth);
    case "score1":
      return String(member.score1 ?? "");
    case "score2":
      return String(member.score2 ?? "");
    case "score3":
      return String(member.score3 ?? "");
    case "assignee":
      return formatAssigneeNames(member, leaderMap);
    case "notes":
      return member.latestNote ?? "";
    case "tasks":
      return formatTasksForExport(tasksByMember.get(member.userId) ?? []);
    case "status":
      return member.status ?? "";
    case "lastAttendedAt":
      return formatTimestampMs(member.lastAttendedAt);
    case "lastFollowupAt":
      return formatTimestampMs(member.lastFollowupAt);
    case "lastActiveAt":
      return formatTimestampMs(member.lastActiveAt);
    case "alerts":
      return (member.alerts ?? []).join("; ");
    default:
      if (colKey.startsWith("custom")) {
        return formatCustomSlotValue(member, colKey, customFields);
      }
      return "";
  }
}

export function headerLabelForColumn(
  colKey: string,
  columnLabelMap: Record<string, string>,
): string {
  if (colKey === "score1" || colKey === "score2" || colKey === "score3") {
    return SCORE_SLOT_TO_NAME[colKey] ?? columnLabelMap[colKey] ?? colKey;
  }
  return columnLabelMap[colKey] ?? colKey;
}

/**
 * Build CSV text for the People / follow-up table using the same column order and labels as the UI.
 */
export function generateFollowupPeopleCsv(
  members: FollowupCsvExportMember[],
  columnKeys: string[],
  columnLabelMap: Record<string, string>,
  leaderMap: Map<string, LeaderInfo>,
  tasksByMember: Map<string, FollowupCsvExportTask[]>,
  customFields: CustomFieldDef[],
): string {
  const dataKeys = columnKeys.filter((k) => k !== "checkbox" && k !== "rowNum");
  const headers = dataKeys.map((k) => headerLabelForColumn(k, columnLabelMap));
  const ctx = { leaderMap, tasksByMember, customFields };
  const rows = members.map((m) =>
    dataKeys.map((key) => cellValueForColumn(key, m, ctx)),
  );
  return generateCSV(headers, rows);
}
