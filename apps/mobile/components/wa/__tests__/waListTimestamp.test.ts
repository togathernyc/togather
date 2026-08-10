/**
 * Unit tests for the Chats-list timestamp format (WA-VISUAL-DELTAS.md §1.6).
 */
import { formatWaListTimestamp } from '../waListTimestamp';

/** Wed 29 Jul 2026, 15:20 local. */
const NOW = new Date(2026, 6, 29, 15, 20, 0).getTime();

function at(y: number, m: number, d: number, h = 12, min = 0) {
  return new Date(y, m, d, h, min, 0).getTime();
}

describe('formatWaListTimestamp', () => {
  it('shows the time of day for today', () => {
    const ts = at(2026, 6, 29, 9, 41);
    // Locale-driven (WhatsApp follows the device's 12/24h setting), so assert
    // against the same Intl call rather than a hard-coded "9:41 AM".
    const expected = new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(formatWaListTimestamp(ts, NOW)).toBe(expected);
  });

  it('shows "Yesterday" for yesterday', () => {
    expect(formatWaListTimestamp(at(2026, 6, 28, 23, 59), NOW)).toBe('Yesterday');
  });

  it('crosses to "Yesterday" on the calendar boundary, not after 24 elapsed hours', () => {
    // 23:55 yesterday, read at 00:05 today — only 10 minutes elapsed, but it
    // is unambiguously yesterday's message.
    const justAfterMidnight = at(2026, 6, 29, 0, 5);
    expect(formatWaListTimestamp(at(2026, 6, 28, 23, 55), justAfterMidnight)).toBe('Yesterday');
  });

  it('shows the weekday name for 2-6 days back', () => {
    expect(formatWaListTimestamp(at(2026, 6, 26), NOW)).toBe('Sunday'); // 3 days back
    expect(formatWaListTimestamp(at(2026, 6, 27), NOW)).toBe('Monday');
    expect(formatWaListTimestamp(at(2026, 6, 23), NOW)).toBe('Thursday'); // 6 days back
  });

  it('switches to a numeric date at 7 days back', () => {
    const ts = at(2026, 6, 22);
    const expected = new Date(ts).toLocaleDateString(undefined, {
      year: '2-digit',
      month: 'numeric',
      day: 'numeric',
    });
    expect(formatWaListTimestamp(ts, NOW)).toBe(expected);
    expect(formatWaListTimestamp(ts, NOW)).not.toMatch(/day$/);
  });

  it('uses the numeric date for last year too (no special-casing)', () => {
    const out = formatWaListTimestamp(at(2025, 0, 15), NOW);
    expect(out).toMatch(/25/);
  });

  it('never emits the old elapsed-duration shapes', () => {
    const samples = [
      at(2026, 6, 29, 15, 19), // a minute ago
      at(2026, 6, 29, 11, 0), // hours ago
      at(2026, 6, 25), // days ago
      at(2026, 6, 3), // weeks ago
    ];
    for (const ts of samples) {
      const out = formatWaListTimestamp(ts, NOW);
      expect(out).not.toBe('now');
      expect(out).not.toMatch(/^\d+[mhd]$/);
    }
  });

  it('treats a future timestamp as today rather than a negative age', () => {
    const ts = at(2026, 6, 29, 23, 30);
    expect(formatWaListTimestamp(ts, NOW)).not.toBe('Yesterday');
    expect(formatWaListTimestamp(ts, NOW)).toMatch(/\d/);
  });

  it('returns an empty string for an invalid timestamp', () => {
    expect(formatWaListTimestamp(Number.NaN, NOW)).toBe('');
  });
});
