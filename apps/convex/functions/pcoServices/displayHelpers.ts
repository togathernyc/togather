/**
 * PCO Services Display Helpers
 *
 * Helper functions for formatting hierarchical display names for PCO items.
 * Used to disambiguate items from different service types that may share names.
 *
 * Display format:
 * - Teams: "Service Type > Team Name"
 * - Positions: "Service Type > Team > Position"
 */

/**
 * Format a team's display name with its service type context.
 *
 * Examples:
 *   formatTeamDisplayName("PRODUCTION", "MANHATTAN") => "MANHATTAN > PRODUCTION"
 *   formatTeamDisplayName("Band", undefined) => "Band"
 *
 * @param teamName - The team's name
 * @param serviceTypeName - The parent service type's name (optional)
 * @returns Formatted display name with hierarchy
 */
export function formatTeamDisplayName(
  teamName: string,
  serviceTypeName: string | undefined
): string {
  if (!serviceTypeName) {
    return teamName;
  }
  return `${serviceTypeName} > ${teamName}`;
}

/**
 * Format a position's display name with full hierarchy context.
 *
 * Examples:
 *   formatPositionDisplayName("Technical Director", "PRODUCTION", "MANHATTAN")
 *     => "MANHATTAN > PRODUCTION > Technical Director"
 *   formatPositionDisplayName("Drums", "Band", undefined)
 *     => "Band > Drums"
 *   formatPositionDisplayName("Volunteer", undefined, undefined)
 *     => "Volunteer"
 *
 * @param positionName - The position's name
 * @param teamName - The parent team's name (optional)
 * @param serviceTypeName - The parent service type's name (optional)
 * @returns Formatted display name with full hierarchy
 */
export function formatPositionDisplayName(
  positionName: string,
  teamName: string | undefined,
  serviceTypeName: string | undefined
): string {
  const parts: string[] = [];

  if (serviceTypeName) {
    parts.push(serviceTypeName);
  }

  if (teamName) {
    parts.push(teamName);
  }

  parts.push(positionName);

  return parts.join(" > ");
}

