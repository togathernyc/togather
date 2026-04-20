import { formatInboxTime } from '../formatInboxTime';

const now = new Date('2026-04-20T14:00:00Z');

describe('formatInboxTime', () => {
  test('empty for null/undefined/NaN', () => {
    expect(formatInboxTime(null)).toBe('');
    expect(formatInboxTime(undefined)).toBe('');
    expect(formatInboxTime(NaN)).toBe('');
  });

  test('"now" for under a minute', () => {
    expect(formatInboxTime(now.getTime() - 30 * 1000, now)).toBe('now');
  });

  test('"{N}m" for minutes', () => {
    expect(formatInboxTime(now.getTime() - 9 * 60 * 1000, now)).toBe('9m');
    expect(formatInboxTime(now.getTime() - 59 * 60 * 1000, now)).toBe('59m');
  });

  test('"{N}h" for hours same day', () => {
    expect(formatInboxTime(now.getTime() - 2 * 60 * 60 * 1000, now)).toBe('2h');
    expect(formatInboxTime(now.getTime() - 23 * 60 * 60 * 1000, now)).toBe('23h');
  });

  test('"Yesterday" for ~24h prior', () => {
    expect(formatInboxTime(now.getTime() - 25 * 60 * 60 * 1000, now)).toBe('Yesterday');
  });

  test('"{N}d" for 2–6 days', () => {
    expect(formatInboxTime(now.getTime() - 3 * 24 * 60 * 60 * 1000, now)).toBe('3d');
    expect(formatInboxTime(now.getTime() - 6 * 24 * 60 * 60 * 1000, now)).toBe('6d');
  });

  test('"MMM D" for >= 7 days in the same year', () => {
    const stamp = new Date('2026-01-15T10:00:00Z').getTime();
    expect(formatInboxTime(stamp, now)).toBe('Jan 15');
  });

  test('"MMM D, YYYY" for previous years', () => {
    const stamp = new Date('2024-11-30T10:00:00Z').getTime();
    expect(formatInboxTime(stamp, now)).toBe('Nov 30, 2024');
  });
});
