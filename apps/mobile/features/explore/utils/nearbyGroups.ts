/**
 * Distance helpers for the Groups directory's "find groups near me".
 *
 * Ordering is done client-side on coordinates the app already has: the explore
 * container geocodes each group's address/zip locally (`getGroupCoordinates`,
 * backed by the offline `us-zips` table) and hands the geocoded subset to the
 * screen, and the user's own origin comes from `useUserLocation` (device GPS,
 * or a 5-digit zip typed into the search field). Nothing here talks to a
 * geocoding service — there is no server-side geocode path in this repo and
 * this feature does not need one.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_MILES = 3959;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in miles.
 *
 * Mirrors `calculateDistanceMiles` in `apps/convex/functions/groupSearch.ts`
 * (the public /nearme search), so the two surfaces rank the same way. Kept
 * local rather than shared: the Convex copy is module-private there, and a
 * shared package for six lines of trigonometry is not worth the hop.
 */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.4 mi" / "12 mi" — one decimal only while it still reads as walkable. */
export function formatMiles(miles: number): string {
  return `${miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles)} mi`;
}

export interface NearbyPartition<T> {
  /** Items with a known location, nearest first, each with its distance. */
  near: Array<{ item: T; miles: number }>;
  /** Items we have no coordinates for — order preserved, shown below. */
  rest: T[];
}

/**
 * Split a list into "has coordinates, sorted by distance" and "everything
 * else". Only SOME groups are geocodable (a group with no address or zip
 * can't be placed), so the un-placed ones are never dropped — they keep their
 * incoming order under the nearby section.
 */
export function partitionByDistance<T>(
  items: readonly T[],
  coordsOf: (item: T) => LatLng | null | undefined,
  origin: LatLng
): NearbyPartition<T> {
  const near: Array<{ item: T; miles: number }> = [];
  const rest: T[] = [];

  items.forEach((item) => {
    const coords = coordsOf(item);
    if (coords) {
      near.push({ item, miles: haversineMiles(origin, coords) });
    } else {
      rest.push(item);
    }
  });

  near.sort((a, b) => a.miles - b.miles);
  return { near, rest };
}

/** True for a bare 5-digit US zip — the search field's "find near this zip" trigger. */
export function isZipQuery(query: string): boolean {
  return /^\d{5}$/.test(query.trim());
}
