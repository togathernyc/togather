/**
 * waEventWhen — the flag-on Events row "when" label.
 *
 * Fixed clock throughout: 2026-07-29 14:00 America/New_York (18:00Z).
 */
import { formatWaEventDay, formatWaEventWhen } from '../utils/waEventWhen';

const TZ = 'America/New_York';
const NOW = Date.parse('2026-07-29T18:00:00.000Z'); // Wed 2:00 PM EDT

describe('formatWaEventDay', () => {
  it('says "Today" for later the same calendar day', () => {
    expect(formatWaEventDay('2026-07-29T23:00:00.000Z', TZ, NOW)).toBe('Today');
  });

  it('says "Tomorrow" for the next calendar day', () => {
    expect(formatWaEventDay('2026-07-30T16:00:00.000Z', TZ, NOW)).toBe('Tomorrow');
  });

  it('uses a bare weekday 2-6 days out', () => {
    // Sat Aug 1, 2026, 3pm EDT
    expect(formatWaEventDay('2026-08-01T19:00:00.000Z', TZ, NOW)).toBe('Sat');
  });

  it('adds the date once a week out or more', () => {
    expect(formatWaEventDay('2026-08-12T19:00:00.000Z', TZ, NOW)).toBe('Wed, Aug 12');
  });

  it('dates past events rather than showing a bare weekday', () => {
    expect(formatWaEventDay('2026-07-27T19:00:00.000Z', TZ, NOW)).toBe('Mon, Jul 27');
  });

  it('buckets on calendar days in the viewer timezone, not elapsed hours', () => {
    // 00:30 EDT on Jul 30 is only 6.5h away but is a different calendar day.
    expect(formatWaEventDay('2026-07-30T04:30:00.000Z', TZ, NOW)).toBe('Tomorrow');
    // Same instant read from Los Angeles is still Jul 29 → "Today".
    expect(formatWaEventDay('2026-07-30T04:30:00.000Z', 'America/Los_Angeles', NOW)).toBe(
      'Today'
    );
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatWaEventDay('not-a-date', TZ, NOW)).toBe('');
  });
});

describe('formatWaEventWhen', () => {
  it('joins the day bucket and a clock time with no timezone abbreviation', () => {
    const label = formatWaEventWhen('2026-07-29T23:00:00.000Z', TZ, NOW);
    expect(label).toBe('Today 7:00 PM');
    expect(label).not.toMatch(/EDT|EST/);
  });

  it('formats a far-out event with its date', () => {
    expect(formatWaEventWhen('2026-08-12T19:00:00.000Z', TZ, NOW)).toBe('Wed, Aug 12 3:00 PM');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatWaEventWhen('nope', TZ, NOW)).toBe('');
  });
});
