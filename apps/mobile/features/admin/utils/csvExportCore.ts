/**
 * Pure CSV string helpers (no native / Expo dependencies).
 * Used by csvExport.ts and other features that only need CSV text generation.
 */

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

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generate CSV content from rows
 */
export function generateCSV(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const headerLine = headers.map(escapeCSVField).join(",");
  const dataLines = rows.map((row) => row.map(escapeCSVField).join(","));
  return [headerLine, ...dataLines].join("\n");
}
