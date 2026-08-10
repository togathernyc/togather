import {
  haversineMiles,
  formatMiles,
  sortByDistance,
  isZipQuery,
} from '../nearbyGroups';

const NYC = { latitude: 40.7128, longitude: -74.006 };
const PHILLY = { latitude: 39.9526, longitude: -75.1652 };
const LA = { latitude: 34.0522, longitude: -118.2437 };

describe('haversineMiles', () => {
  it('is zero for the same point', () => {
    expect(haversineMiles(NYC, NYC)).toBe(0);
  });

  it('matches known great-circle distances', () => {
    // NYC -> Philadelphia is ~80 mi; NYC -> LA is ~2445 mi.
    expect(haversineMiles(NYC, PHILLY)).toBeCloseTo(80.5, 0);
    expect(haversineMiles(NYC, LA)).toBeCloseTo(2445, -1);
  });

  it('is symmetric', () => {
    expect(haversineMiles(NYC, LA)).toBeCloseTo(haversineMiles(LA, NYC), 6);
  });

  it('handles antimeridian-spanning pairs without going the wrong way round', () => {
    const west = { latitude: 0, longitude: -179.5 };
    const east = { latitude: 0, longitude: 179.5 };
    // 1 degree of longitude at the equator ~ 69 miles, not ~24,800.
    expect(haversineMiles(west, east)).toBeLessThan(80);
  });
});

describe('formatMiles', () => {
  it('keeps one decimal while distances are still walkable', () => {
    expect(formatMiles(0.42)).toBe('0.4 mi');
    expect(formatMiles(3.06)).toBe('3.1 mi');
  });

  it('rounds to whole miles past 10', () => {
    expect(formatMiles(12.4)).toBe('12 mi');
    expect(formatMiles(2445.2)).toBe('2445 mi');
  });
});

describe('sortByDistance', () => {
  type G = { id: string; coords?: { latitude: number; longitude: number } };
  const coordsOf = (g: G) => g.coords ?? null;

  it('orders located items nearest-first with the un-placed ones trailing', () => {
    const items: G[] = [
      { id: 'la', coords: LA },
      { id: 'nowhere-a' },
      { id: 'philly', coords: PHILLY },
      { id: 'nowhere-b' },
      { id: 'nyc', coords: NYC },
    ];

    const ranked = sortByDistance(items, coordsOf, NYC);

    // Every item survives — the un-geocoded ones are never dropped, never
    // interleaved, and keep their incoming order.
    expect(ranked.map((r) => r.item.id)).toEqual([
      'nyc',
      'philly',
      'la',
      'nowhere-a',
      'nowhere-b',
    ]);
    expect(ranked[0].miles).toBe(0);
    expect(ranked[1].miles!).toBeLessThan(ranked[2].miles!);
    expect(ranked[3].miles).toBeNull();
    expect(ranked[4].miles).toBeNull();
  });

  it('marks everything as un-placed when nothing is geocoded', () => {
    const items: G[] = [{ id: 'a' }, { id: 'b' }];
    const ranked = sortByDistance(items, coordsOf, NYC);
    expect(ranked.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(ranked.every((r) => r.miles === null)).toBe(true);
  });

  it('is stable for equal distances', () => {
    const items: G[] = [
      { id: 'tie-a', coords: PHILLY },
      { id: 'tie-b', coords: PHILLY },
      { id: 'tie-c', coords: PHILLY },
    ];
    expect(sortByDistance(items, coordsOf, NYC).map((r) => r.item.id)).toEqual([
      'tie-a',
      'tie-b',
      'tie-c',
    ]);
  });

  it('does not mutate the input array', () => {
    const items: G[] = [
      { id: 'la', coords: LA },
      { id: 'nyc', coords: NYC },
    ];
    sortByDistance(items, coordsOf, NYC);
    expect(items.map((g) => g.id)).toEqual(['la', 'nyc']);
  });
});

describe('isZipQuery', () => {
  it.each(['12345', '02134', '  90210  '])('accepts %p', (q) => {
    expect(isZipQuery(q)).toBe(true);
  });

  it.each(['1234', '123456', 'youth', '', '1234a', '10001-1234'])('rejects %p', (q) => {
    expect(isZipQuery(q)).toBe(false);
  });
});
