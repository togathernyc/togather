/**
 * Format a last-message timestamp for inbox rows.
 *
 *   < 1 min         → "now"
 *   < 1 hr          → "{N}m"
 *   < 24 hr         → "{N}h"
 *   yesterday       → "Yesterday"
 *   < 7 days        → "{N}d"
 *   current year    → "MMM D" (e.g., "Jan 15")
 *   other           → "MMM D, YYYY"
 *
 * Shared by the production GroupedInboxItem and the design-theme inbox
 * components (Hearth/Console/Conservatory) so both render identical labels.
 *
 * Accepts millisecond timestamps; returns "" for null/undefined/NaN so callers
 * don't need to branch.
 */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatInboxTime(timestamp: number | null | undefined, now: Date = new Date()): string {
  if (timestamp == null || Number.isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;

  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  if (date.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()}`;
  }
  return `${month} ${day}`;
}
