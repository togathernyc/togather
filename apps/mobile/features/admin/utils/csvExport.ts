/**
 * CSV Export Utilities
 *
 * Utilities for generating, saving, and sharing CSV files for stats exports.
 */

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MailComposer from "expo-mail-composer";
import * as Clipboard from "expo-clipboard";
import { Alert } from "react-native";

/**
 * Escape a field for CSV format
 * - Wraps in quotes if contains comma, quote, or newline
 * - Escapes internal quotes by doubling them
 */
export function escapeCSVField(field: string | number | null | undefined): string {
  if (field === null || field === undefined) {
    return "";
  }

  const str = String(field);

  // Check if field needs quoting
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    // Escape quotes by doubling them, then wrap in quotes
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generate CSV content from rows
 */
export function generateCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCSVField).join(",");
  const dataLines = rows.map((row) => row.map(escapeCSVField).join(","));
  return [headerLine, ...dataLines].join("\n");
}

// Types for member data
interface MemberData {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  lastLogin?: string | null;
  joinedAt?: string | null;
}

/**
 * Generate CSV for member lists (active or new members)
 */
export function generateMembersCsv(
  members: MemberData[],
  type: "active" | "new"
): string {
  const headers =
    type === "active"
      ? ["Name", "Email", "Last Active"]
      : ["Name", "Email", "Joined Date"];

  const rows = members.map((member) => {
    const name = `${member.firstName || ""} ${member.lastName || ""}`.trim() || "Unknown";
    const dateField = type === "active" ? member.lastLogin : member.joinedAt;
    const formattedDate = dateField
      ? new Date(dateField).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "";

    return [name, member.email, formattedDate];
  });

  return generateCSV(headers, rows);
}

// Types for group type attendance data
interface GroupTypeAttendanceData {
  totalAttended: number;
  totalRecords: number;
  totalMeetings: number;
  overallRate: number;
  startDate: string;
  endDate: string;
  groupBreakdown: Array<{
    groupId: string;
    groupName: string;
    attended: number;
    total: number;
    meetingCount: number;
    rate: number;
  }>;
}

/**
 * Generate CSV for group type attendance summary
 */
export function generateGroupTypeAttendanceCsv(
  data: GroupTypeAttendanceData,
  groupTypeName: string
): string {
  const headers = ["Group Name", "Meetings", "Members Present", "Attendance Rate"];

  const rows = data.groupBreakdown.map((group) => [
    group.groupName,
    group.meetingCount,
    group.attended,
    `${group.rate}%`,
  ]);

  // Add summary row
  rows.push([
    `TOTAL (${groupTypeName})`,
    data.totalMeetings,
    data.totalAttended,
    `${data.overallRate}%`,
  ]);

  return generateCSV(headers, rows);
}

// Types for single day attendance
interface SingleDayAttendanceData {
  groupName: string;
  date: string;
  memberAttendance: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    status: number | null;
    statusLabel: string;
  }>;
  presentCount: number;
  absentCount: number;
  notRecordedCount: number;
}

// Types for date range attendance
interface DateRangeAttendanceData {
  groupName: string;
  startDate: string;
  endDate: string;
  meetingColumns: Array<{
    meetingId: string;
    date: string;
    dateLabel: string;
  }>;
  memberRows: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    attendanceByMeeting: Record<string, number | null>;
    attendanceRate: number;
  }>;
}

/**
 * Generate CSV for single day group attendance
 */
export function generateSingleDayAttendanceCsv(data: SingleDayAttendanceData): string {
  const headers = ["Member Name", "Status"];

  const rows = data.memberAttendance.map((member) => [
    `${member.firstName} ${member.lastName}`.trim(),
    member.statusLabel,
  ]);

  return generateCSV(headers, rows);
}

/**
 * Generate CSV for date range group attendance
 */
export function generateDateRangeAttendanceCsv(data: DateRangeAttendanceData): string {
  // Headers: Member Name, [Date columns...], Attendance Rate
  const headers = [
    "Member Name",
    ...data.meetingColumns.map((m) => m.dateLabel),
    "Attendance Rate",
  ];

  const rows = data.memberRows.map((member) => {
    const attendanceValues = data.meetingColumns.map((meeting) => {
      const status = member.attendanceByMeeting[meeting.meetingId];
      if (status === 1) return "Present";
      if (status === 0) return "Absent";
      return "Not Recorded";
    });

    return [
      `${member.firstName} ${member.lastName}`.trim(),
      ...attendanceValues,
      `${member.attendanceRate}%`,
    ];
  });

  return generateCSV(headers, rows);
}

/**
 * Format a date for use in filenames (no special characters)
 */
function formatDateForFilename(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  }).replace(/\s+/g, "").replace(/,/g, "");
}

/**
 * Sanitize a string for use in filenames
 */
function sanitizeFilename(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Generate a filename for the export
 */
export function generateFilename(
  type: "active_members" | "new_members" | "attendance",
  communityName: string,
  additionalInfo?: { groupTypeName?: string; startDate?: string; endDate?: string; date?: string }
): string {
  const community = sanitizeFilename(communityName);
  const timestamp = new Date().toISOString().split("T")[0];

  switch (type) {
    case "active_members":
      return `active_members_${community}_${timestamp}.csv`;
    case "new_members":
      return `new_members_${community}_${timestamp}.csv`;
    case "attendance":
      if (additionalInfo?.groupTypeName) {
        const groupType = sanitizeFilename(additionalInfo.groupTypeName);
        if (additionalInfo.date) {
          const dateStr = formatDateForFilename(additionalInfo.date);
          return `attendance_${groupType}_${dateStr}.csv`;
        } else if (additionalInfo.startDate && additionalInfo.endDate) {
          const start = formatDateForFilename(additionalInfo.startDate);
          const end = formatDateForFilename(additionalInfo.endDate);
          return `attendance_${groupType}_${start}-${end}.csv`;
        }
        return `attendance_${groupType}_${timestamp}.csv`;
      }
      return `attendance_${timestamp}.csv`;
  }
}

/**
 * Copy CSV content to clipboard
 */
export async function copyToClipboard(content: string): Promise<void> {
  await Clipboard.setStringAsync(content);
}

/**
 * Save CSV to file and share it
 */
export async function saveAndShareCSV(filename: string, content: string): Promise<void> {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;

  // Write the file
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // Check if sharing is available
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert(
      "Sharing Not Available",
      "File sharing is not available on this device. The file has been saved to the app's cache."
    );
    return;
  }

  // Share the file
  await Sharing.shareAsync(fileUri, {
    mimeType: "text/csv",
    dialogTitle: "Save CSV File",
    UTI: "public.comma-separated-values-text",
  });
}

/**
 * Send CSV via email
 */
export async function emailCSV(
  filename: string,
  content: string,
  recipientEmail: string,
  subject: string,
  body: string
): Promise<void> {
  // Check if mail composer is available
  const isAvailable = await MailComposer.isAvailableAsync();
  if (!isAvailable) {
    Alert.alert(
      "Email Not Available",
      "Email is not configured on this device. Please set up an email account in Settings."
    );
    return;
  }

  // Write the file temporarily
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // Compose email with attachment
  await MailComposer.composeAsync({
    recipients: [recipientEmail],
    subject,
    body,
    attachments: [fileUri],
  });
}
