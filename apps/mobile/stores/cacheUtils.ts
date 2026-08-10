/**
 * Shared helpers for the offline cache stores (`stores/*Cache.ts`).
 */

/** A cached blob tagged with the time it was written. */
export interface TimestampedEntry {
  timestamp: number;
}

/**
 * Cap a keyed cache at `max` entries, dropping the oldest by `timestamp`
 * (simple LRU by write time). Returns the same object if already within bounds.
 */
export function evictOldestByTimestamp<T extends TimestampedEntry>(
  entries: Record<string, T>,
  max: number,
): Record<string, T> {
  const all = Object.entries(entries);
  if (all.length <= max) return entries;
  const sorted = all.sort(
    ([, a], [, b]) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
  );
  const result = { ...entries };
  sorted.slice(0, all.length - max).forEach(([key]) => delete result[key]);
  return result;
}
