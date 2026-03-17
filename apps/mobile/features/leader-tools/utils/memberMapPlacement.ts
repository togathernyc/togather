import zipcodes from "zipcodes";
import usZips from "us-zips";

export interface MemberMapSubject {
  id: string;
  zipCode?: string | null;
}

export interface MemberMapPlacement {
  latitude: number;
  longitude: number;
  zipCode: string;
  usedBoundary: boolean;
}

type Position = [number, number];

type ZipFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: Position[][] | Position[][][];
  } | null;
};

type ZipFeatureCollection = {
  type: "FeatureCollection";
  features: ZipFeature[];
};

const ZIP_STATE_FILE_API =
  "https://api.github.com/repos/OpenDataDE/State-zip-code-GeoJSON/contents";

const stateFileCache = new Map<string, Promise<string | null>>();
const stateCollectionCache = new Map<string, Promise<ZipFeatureCollection | null>>();
const zipFeatureCache = new Map<string, Promise<ZipFeature | null>>();

function normalizeZipCode(zipCode?: string | null): string | null {
  if (!zipCode) return null;
  const digits = String(zipCode).trim().match(/\d/g)?.join("") ?? "";
  if (digits.length < 3) return null;
  return digits.slice(0, 5).padStart(5, "0");
}

function getZipCenter(zipCode: string): { latitude: number; longitude: number } | null {
  const usZip = (usZips as Record<string, { latitude?: number; longitude?: number }>)[zipCode];
  if (usZip?.latitude != null && usZip?.longitude != null) {
    return {
      latitude: usZip.latitude,
      longitude: usZip.longitude,
    };
  }

  const zipInfo = zipcodes.lookup(zipCode);
  if (zipInfo?.latitude != null && zipInfo?.longitude != null) {
    return {
      latitude: zipInfo.latitude,
      longitude: zipInfo.longitude,
    };
  }

  return null;
}

async function getStateFileUrl(stateCode: string): Promise<string | null> {
  const upperCode = stateCode.toUpperCase();
  let cached = stateFileCache.get(upperCode);
  if (cached) return cached;

  cached = (async () => {
    const response = await fetch(ZIP_STATE_FILE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;

    const files = (await response.json()) as Array<{
      name?: string;
      download_url?: string | null;
    }>;

    const prefix = `${upperCode.toLowerCase()}_`;
    const match = files.find((file) => file.name?.startsWith(prefix));
    return match?.download_url ?? null;
  })();

  stateFileCache.set(upperCode, cached);
  return cached;
}

async function getStateCollection(stateCode: string): Promise<ZipFeatureCollection | null> {
  const upperCode = stateCode.toUpperCase();
  let cached = stateCollectionCache.get(upperCode);
  if (cached) return cached;

  cached = (async () => {
    const fileUrl = await getStateFileUrl(upperCode);
    if (!fileUrl) return null;
    const response = await fetch(fileUrl);
    if (!response.ok) return null;
    return (await response.json()) as ZipFeatureCollection;
  })();

  stateCollectionCache.set(upperCode, cached);
  return cached;
}

function extractFeatureZip(feature: ZipFeature): string | null {
  const props = feature.properties ?? {};
  const candidates = [
    props.ZCTA5CE10,
    props.ZCTA5CE20,
    props.ZCTA5CE,
    props.zip,
    props.ZIP,
    props.GEOID10,
    props.GEOID20,
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const normalized = normalizeZipCode(value.slice(-5));
    if (normalized) return normalized;
  }

  return null;
}

async function getZipFeature(zipCode: string): Promise<ZipFeature | null> {
  let cached = zipFeatureCache.get(zipCode);
  if (cached) return cached;

  cached = (async () => {
    const zipInfo = zipcodes.lookup(zipCode);
    const stateCode = zipInfo?.state;
    if (!stateCode) return null;

    const collection = await getStateCollection(stateCode);
    if (!collection?.features?.length) return null;

    return (
      collection.features.find((feature) => extractFeatureZip(feature) === zipCode) ?? null
    );
  })();

  zipFeatureCache.set(zipCode, cached);
  return cached;
}

function createSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seedInput: string) {
  let seed = createSeed(seedInput) || 1;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function getGeometryPolygons(geometry: ZipFeature["geometry"]): Position[][][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return [geometry.coordinates as Position[][]];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates as Position[][][];
  }
  return [];
}

function getFeatureBounds(feature: ZipFeature): {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
} | null {
  const polygons = getGeometryPolygons(feature.geometry);
  if (polygons.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  const [x, y] = point;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInFeature(point: Position, feature: ZipFeature): boolean {
  const polygons = getGeometryPolygons(feature.geometry);
  for (const polygon of polygons) {
    const [outerRing, ...holes] = polygon;
    if (!outerRing || !pointInRing(point, outerRing)) continue;
    if (holes.some((ring) => pointInRing(point, ring))) continue;
    return true;
  }
  return false;
}

function getFeatureInteriorPoint(feature: ZipFeature): Position | null {
  const props = feature.properties ?? {};
  const lon = typeof props.INTPTLON10 === "string" ? Number(props.INTPTLON10) : null;
  const lat = typeof props.INTPTLAT10 === "string" ? Number(props.INTPTLAT10) : null;
  if (lon != null && lat != null && Number.isFinite(lon) && Number.isFinite(lat)) {
    return [lon, lat];
  }

  const bounds = getFeatureBounds(feature);
  if (!bounds) return null;
  return [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

function approximateZipPoint(zipCode: string, seedInput: string): MemberMapPlacement | null {
  const center = getZipCenter(zipCode);
  if (!center) return null;

  const random = createRandom(seedInput);
  const radiusLat = 0.018;
  const radiusLng = 0.022;
  const angle = random() * Math.PI * 2;
  const distance = Math.sqrt(random());

  return {
    latitude: center.latitude + Math.sin(angle) * radiusLat * distance,
    longitude: center.longitude + Math.cos(angle) * radiusLng * distance,
    zipCode,
    usedBoundary: false,
  };
}

async function computeZipPlacement(
  zipCode: string,
  seedInput: string,
): Promise<MemberMapPlacement | null> {
  const feature = await getZipFeature(zipCode);
  if (!feature?.geometry) {
    return approximateZipPoint(zipCode, seedInput);
  }

  const bounds = getFeatureBounds(feature);
  if (!bounds) {
    return approximateZipPoint(zipCode, seedInput);
  }

  const random = createRandom(seedInput);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const lng = bounds.minLng + random() * (bounds.maxLng - bounds.minLng);
    const lat = bounds.minLat + random() * (bounds.maxLat - bounds.minLat);
    if (pointInFeature([lng, lat], feature)) {
      return {
        latitude: lat,
        longitude: lng,
        zipCode,
        usedBoundary: true,
      };
    }
  }

  const fallbackPoint = getFeatureInteriorPoint(feature);
  if (fallbackPoint) {
    return {
      latitude: fallbackPoint[1],
      longitude: fallbackPoint[0],
      zipCode,
      usedBoundary: true,
    };
  }

  return approximateZipPoint(zipCode, seedInput);
}

export async function computeMemberMapPlacements(
  members: MemberMapSubject[],
): Promise<Map<string, MemberMapPlacement>> {
  const placements = new Map<string, MemberMapPlacement>();

  await Promise.all(
    members.map(async (member, index) => {
      const zipCode = normalizeZipCode(member.zipCode);
      if (!zipCode) return;

      const placement = await computeZipPlacement(zipCode, `${zipCode}:${member.id}:${index}`);
      if (!placement) return;

      placements.set(member.id, placement);
    }),
  );

  return placements;
}
