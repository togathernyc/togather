/**
 * Shared utilities for RunSheet functionality.
 * These normalizers ensure consistency between the RunSheet display
 * and the RunSheet settings.
 */

// Common role name variations to normalize
// IMPORTANT: Order matters! More specific aliases must come before generic ones.
// For example, "audio cues" should match "audio" before "cue".
export const ROLE_ALIASES: [string, string][] = [
  // Specific multi-word aliases first
  ["technical director", "TD"],
  ["tech director", "TD"],
  ["service director", "SD"],
  ["srv director", "SD"],
  ["service cue", "Service Cues"],
  ["service cues", "Service Cues"],
  // Department-specific aliases (before generic "cue")
  ["audio cue", "Audio"],
  ["video cue", "Video"],
  ["lighting cue", "Lighting"],
  ["light cue", "Lighting"],
  ["stage cue", "Stage"],
  // Department names
  ["audio", "Audio"],
  ["foh", "Audio"],
  ["monitors", "Audio"],
  ["video", "Video"],
  ["pvp", "Video"],
  ["propresenter", "Video"],
  ["pro7", "Video"],
  ["lighting", "Lighting"],
  ["lights", "Lighting"],
  ["stage", "Stage"],
  ["platform", "Stage"],
  // Generic cue aliases last (fallback)
  ["cue", "Service Cues"],
  ["cues", "Service Cues"],
];

/**
 * Normalizes a PCO category name to a consistent display name.
 * This ensures that variants like "Video -PVP", "Video - Pro 7", and "Video"
 * all normalize to "Video".
 *
 * @param category - The raw category name from PCO
 * @returns The normalized category name
 */
export function normalizeRoleName(category: string): string {
  const lower = category.toLowerCase().trim();
  // Check aliases in order (more specific first)
  for (const [alias, normalized] of ROLE_ALIASES) {
    if (lower.includes(alias)) {
      return normalized;
    }
  }
  // Capitalize first letter of each word
  return category.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/**
 * Role colors matching ScriptViewer's column colors.
 */
export const ROLE_COLORS: Record<string, string> = {
  Audio: "#4A7C59",      // Green
  Video: "#D4A84B",      // Gold/Yellow
  Lighting: "#8B7355",   // Brown/Tan
  Stage: "#6B8E8E",      // Teal
  TD: "#7B4B94",         // Purple
  SD: "#4A90A4",         // Blue
  "Service Cues": "#C4564A", // Red
  All: "#666666",        // Gray for all view
};

/**
 * Gets the color for a role/category.
 *
 * @param role - The normalized role name
 * @returns The color hex code for the role
 */
export function getRoleColor(role: string): string {
  return ROLE_COLORS[role] || ROLE_COLORS.All;
}

/**
 * Sanitizes HTML content from PCO notes.
 * Converts <br> to newlines and strips other HTML tags.
 *
 * @param content - The raw HTML content from PCO
 * @returns Sanitized plain text content
 */
export function sanitizeNoteContent(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, "\n")  // Convert <br> to newlines
    .replace(/<[^>]+>/g, "")         // Strip other HTML tags
    .trim();
}
