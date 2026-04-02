/**
 * Denormalized meeting search text for full-text search.
 * Keeps one implementation for all meeting insert/update paths.
 */
export function buildMeetingSearchText(fields: {
  title?: string;
  locationOverride?: string;
  groupName?: string;
}): string {
  return [fields.title, fields.locationOverride, fields.groupName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
