import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import { Group } from '@features/groups/types';
import { MAP_CONFIG, MAP_STYLE, getGroupTypeColor } from '../constants';

// Only import mapbox-gl on web
let mapboxgl: any = null;
if (Platform.OS === 'web') {
  mapboxgl = require('mapbox-gl');
  require('mapbox-gl/dist/mapbox-gl.css');
}

// Import native map component for iOS/Android
let ExploreMapNative: any = null;
if (Platform.OS !== 'web') {
  ExploreMapNative = require('./ExploreMapNative').ExploreMapNative;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface ExploreMapProps {
  groups: Group[];
  selectedGroupId: number | null;
  onGroupSelect: (group: Group | null) => void;
  onBoundsChange?: (bounds: MapBounds, visibleGroups: Group[]) => void;
  mapboxToken: string;
}

// Source and layer IDs
const SOURCE_ID = 'groups-source';
const PHOTO_LAYER = 'group-photos';
const SELECTED_PHOTO_LAYER = 'selected-photo';

// Base spread radius in degrees - will be scaled based on zoom level
// Smaller value = tighter grouping, allows some overlap
const BASE_SPREAD_RADIUS = 0.00012;

// Generate initials from a group name (e.g., "Northside Life Group" -> "NL")
const getInitials = (name: string | undefined | null): string => {
  if (!name) return 'G';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  // Take first letter of first two significant words
  return (words[0][0] + words[1][0]).toUpperCase();
};

// Create a circular image with a colored ring using canvas
const createCircularImage = (
  imageUrl: string | null,
  ringColor: string,
  groupName: string,
  size: number = 64,
  ringWidth: number = 6
): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    const totalSize = size + ringWidth * 2;
    canvas.width = totalSize;
    canvas.height = totalSize;

    // Helper to draw initials placeholder
    const drawInitialsPlaceholder = () => {
      // Draw the colored ring
      ctx.beginPath();
      ctx.arc(totalSize / 2, totalSize / 2, totalSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = ringColor;
      ctx.fill();

      // Draw white border
      ctx.beginPath();
      ctx.arc(totalSize / 2, totalSize / 2, totalSize / 2 - 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Draw colored center circle
      ctx.beginPath();
      ctx.arc(totalSize / 2, totalSize / 2, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = ringColor;
      ctx.fill();

      // Draw initials text
      const initials = getInitials(groupName);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${size * 0.4}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, totalSize / 2, totalSize / 2);

      resolve(canvas);
    };

    // If no image URL, draw initials directly
    if (!imageUrl) {
      drawInitialsPlaceholder();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // Draw the colored ring
      ctx.beginPath();
      ctx.arc(totalSize / 2, totalSize / 2, totalSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = ringColor;
      ctx.fill();

      // Draw white border
      ctx.beginPath();
      ctx.arc(totalSize / 2, totalSize / 2, totalSize / 2 - 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Clip to circle for the image
      ctx.beginPath();
      ctx.arc(totalSize / 2, totalSize / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();

      // Draw the image centered
      ctx.drawImage(
        img,
        ringWidth,
        ringWidth,
        size,
        size
      );

      resolve(canvas);
    };

    img.onerror = () => {
      drawInitialsPlaceholder();
    };

    img.src = imageUrl;
  });
};

export function ExploreMap({
  groups,
  selectedGroupId,
  onGroupSelect,
  onBoundsChange,
  mapboxToken,
}: ExploreMapProps) {
  const mapWrapperRef = useRef<HTMLDivElement | null>(null);
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const loadedImagesRef = useRef<Set<string>>(new Set());
  const groupsMapRef = useRef<Map<number, Group>>(new Map());
  const groupsRef = useRef<Group[]>(groups);
  const onBoundsChangeRef = useRef(onBoundsChange);

  // Keep refs in sync with props to avoid stale closures
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const isValidToken = mapboxToken && mapboxToken.startsWith('pk.');

  // Get image name for a group
  const getImageName = useCallback((groupId: number) => `group-photo-${groupId}`, []);

  // Convert groups to GeoJSON FeatureCollection with spread for overlapping markers
  const getGeoJSON = useCallback((groupsList: Group[], zoom: number = 10) => {
    const groupsWithLocation = groupsList.filter(
      (group) => group.latitude != null && group.longitude != null
    );

    // Group markers by their coordinates (rounded to detect overlaps)
    const coordPrecision = 5; // ~1 meter precision
    const coordGroups = new Map<string, Group[]>();

    groupsWithLocation.forEach((group) => {
      const key = `${group.latitude!.toFixed(coordPrecision)},${group.longitude!.toFixed(coordPrecision)}`;
      if (!coordGroups.has(key)) {
        coordGroups.set(key, []);
      }
      coordGroups.get(key)!.push(group);
    });

    // Create features with spread coordinates for overlapping markers
    const features = groupsWithLocation.map((group) => {
      const key = `${group.latitude!.toFixed(coordPrecision)},${group.longitude!.toFixed(coordPrecision)}`;
      const overlappingGroups = coordGroups.get(key) || [group];

      let lng = group.longitude!;
      let lat = group.latitude!;

      // If there are multiple groups at this location, spread them in a circle
      if (overlappingGroups.length > 1) {
        const index = overlappingGroups.findIndex((g) => g.id === group.id);
        const count = overlappingGroups.length;

        // Arrange in a circle around the original point
        const angle = (2 * Math.PI * index) / count;

        // Progressive spread: tighter when zoomed out, more spread when zoomed in
        // At zoom 10 (zoomed out): very tight clustering with overlap
        // At zoom 18+ (zoomed in): nicely spread out for easy selection at building level
        const minZoom = 10;
        const maxZoom = 18;
        const clampedZoom = Math.max(minZoom, Math.min(maxZoom, zoom));

        // Spread multiplier increases exponentially as we zoom in
        // At zoom 10: ~0.3, at zoom 14: ~1.5, at zoom 18: ~6.0
        const zoomProgress = (clampedZoom - minZoom) / (maxZoom - minZoom);
        const spreadMultiplier = 0.3 + Math.pow(zoomProgress, 0.7) * 5.7;

        // Base geographic offset that gets smaller as we zoom in (to maintain visual size)
        const geoOffset = BASE_SPREAD_RADIUS * Math.pow(2, 16 - zoom);

        const adjustedRadius = geoOffset * spreadMultiplier;
        lng += Math.cos(angle) * adjustedRadius;
        lat += Math.sin(angle) * adjustedRadius;
      }

      return {
        type: 'Feature' as const,
        id: group.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
        properties: {
          id: group.id,
          name: group.name,
          description: group.description || '',
          groupType: Number(group.group_type ?? group.type ?? 1),
          imageName: getImageName(typeof group.id === 'number' ? group.id : parseInt(String(group.id), 10)),
          hasImage: !!group.image_url,
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [getImageName]);

  // Build groups lookup map
  useEffect(() => {
    groupsMapRef.current.clear();
    groups.forEach((group) => {
      const groupId = typeof group.id === 'number' ? group.id : parseInt(String(group.id), 10);
      groupsMapRef.current.set(groupId, group);
    });
  }, [groups]);

  // Load a single image into the map using canvas for circular rendering
  const loadGroupImage = useCallback(async (mapInstance: any, group: Group): Promise<void> => {
    const groupId = typeof group.id === 'number' ? group.id : parseInt(String(group.id), 10);
    const imageName = getImageName(groupId);

    // Skip if already loaded
    if (loadedImagesRef.current.has(imageName) || mapInstance.hasImage(imageName)) {
      loadedImagesRef.current.add(imageName);
      return;
    }

    const imageUrl = group.preview || group.image_url || null;
    const ringColor = getGroupTypeColor(Number(group.group_type ?? group.type ?? 1));
    const groupName = group.name || group.title || '';

    try {
      const canvas = await createCircularImage(imageUrl, ringColor, groupName, 56, 6);
      const imageData = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);

      if (imageData && !mapInstance.hasImage(imageName)) {
        mapInstance.addImage(imageName, imageData);
        loadedImagesRef.current.add(imageName);
      }
    } catch (error) {
      console.warn(`Failed to create image for group ${group.id}:`, error);
    }
  }, [getImageName]);

  // Initialize map (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !mapboxgl || !mapWrapperRef.current) {
      return;
    }

    if (map.current) return;

    if (!isValidToken) {
      setMapError(
        'Invalid Mapbox token. Please use a public access token (pk.*) instead of a secret token (sk.*).'
      );
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    // Create a fresh container div for each map instance to avoid
    // stale DOM state after React StrictMode cleanup/remount cycles.
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    mapWrapperRef.current.appendChild(container);
    mapContainer.current = container;

    const mapInstance = new mapboxgl.Map({
      container,
      style: MAP_STYLE,
      center: [MAP_CONFIG.defaultCenter.lng, MAP_CONFIG.defaultCenter.lat],
      zoom: MAP_CONFIG.defaultZoom,
      pitch: MAP_CONFIG.pitch,
      bearing: MAP_CONFIG.bearing,
      minZoom: MAP_CONFIG.minZoom,
      maxZoom: MAP_CONFIG.maxZoom,
    });

    mapInstance.on('error', (event: any) => {
      const message = event?.error?.message || 'Failed to load the map.';
      console.warn('[ExploreMap] Web map error:', event?.error || event);
      setMapError(message);
    });

    mapInstance.on('load', () => {
      setMapError(null);
      // Add 3D buildings layer
      const layers = mapInstance.getStyle()?.layers;
      if (layers) {
        let labelLayerId: string | undefined;
        for (const layer of layers) {
          if (layer.type === 'symbol' && layer.layout?.['text-field']) {
            labelLayerId = layer.id;
            break;
          }
        }

        if (mapInstance.getSource('composite')) {
          mapInstance.addLayer(
            {
              id: '3d-buildings',
              source: 'composite',
              'source-layer': 'building',
              filter: ['==', 'extrude', 'true'],
              type: 'fill-extrusion',
              minzoom: 15,
              paint: {
                'fill-extrusion-color': '#aaa',
                'fill-extrusion-height': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15,
                  0,
                  15.05,
                  ['get', 'height'],
                ],
                'fill-extrusion-base': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15,
                  0,
                  15.05,
                  ['get', 'min_height'],
                ],
                'fill-extrusion-opacity': 0.6,
              },
            },
            labelLayerId
          );
        }
      }

      // Add the GeoJSON source
      mapInstance.addSource(SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Photo layer (symbol with group images - ring is baked into the image)
      mapInstance.addLayer({
        id: PHOTO_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'icon-image': ['get', 'imageName'],
          'icon-size': 0.5,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // Selected photo layer (larger version for selected item)
      mapInstance.addLayer({
        id: SELECTED_PHOTO_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['==', ['get', 'id'], -1],
        layout: {
          'icon-image': ['get', 'imageName'],
          'icon-size': 1.2,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // Click handler for photos
      mapInstance.on('click', PHOTO_LAYER, (e: any) => {
        const features = mapInstance.queryRenderedFeatures(e.point, {
          layers: [PHOTO_LAYER],
        });
        if (!features.length) return;
        const groupId = features[0].properties.id;
        const group = groupsMapRef.current.get(groupId);
        if (group) onGroupSelect(group);
      });

      // Hover effects
      mapInstance.on('mouseenter', PHOTO_LAYER, () => {
        mapInstance.getCanvas().style.cursor = 'pointer';
      });

      mapInstance.on('mouseleave', PHOTO_LAYER, () => {
        mapInstance.getCanvas().style.cursor = '';
      });

      // Click on background to deselect
      mapInstance.on('click', (e: any) => {
        const features = mapInstance.queryRenderedFeatures(e.point, {
          layers: [PHOTO_LAYER, SELECTED_PHOTO_LAYER],
        });
        if (features.length === 0) {
          onGroupSelect(null);
        }
      });

      // Listen for map movement to update visible groups
      // Use refs to avoid stale closure - groupsRef and onBoundsChangeRef are kept in sync with props
      mapInstance.on('moveend', () => {
        if (onBoundsChangeRef.current) {
          const bounds = mapInstance.getBounds();
          if (bounds) {
            const mapBounds: MapBounds = {
              north: bounds.getNorth(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              west: bounds.getWest(),
            };
            const visibleGroups = groupsRef.current.filter((group) => {
              if (group.latitude == null || group.longitude == null) return false;
              return (
                group.latitude >= mapBounds.south &&
                group.latitude <= mapBounds.north &&
                group.longitude >= mapBounds.west &&
                group.longitude <= mapBounds.east
              );
            });
            onBoundsChangeRef.current(mapBounds, visibleGroups);
          }
        }
      });

      setMapLoaded(true);
    });

    map.current = mapInstance;

    return () => {
      loadedImagesRef.current.clear();
      hasFittedRef.current = false;
      setMapLoaded(false);
      mapInstance.remove();
      map.current = null;
      mapContainer.current = null;
      container.remove();
    };
  }, [isValidToken, mapboxToken, onGroupSelect]);

  // Update GeoJSON source with current zoom level
  const updateGeoJSONSource = useCallback(() => {
    if (!map.current) return;
    const source = map.current.getSource(SOURCE_ID) as any;
    if (source) {
      const zoom = map.current.getZoom();
      source.setData(getGeoJSON(groups, zoom));
    }
  }, [groups, getGeoJSON]);

  // Load images and update GeoJSON when groups change
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const mapInstance = map.current;
    const groupsWithLocation = groups.filter(
      (g) => g.latitude != null && g.longitude != null
    );

    // Always update the GeoJSON source first to reflect any filtering changes
    // This ensures markers are removed/added immediately when filters change
    updateGeoJSONSource();

    // If no groups, we're done (source was already cleared above)
    if (groupsWithLocation.length === 0) return;

    // Load images in batches to avoid overwhelming mobile browsers
    // Mobile Safari has stricter limits on concurrent connections
    const BATCH_SIZE = 6;

    const loadImagesInBatches = async () => {
      for (let i = 0; i < groupsWithLocation.length; i += BATCH_SIZE) {
        const batch = groupsWithLocation.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((group) => loadGroupImage(mapInstance, group))
        );
        // Update source after each batch so markers appear progressively
        updateGeoJSONSource();
      }
    };

    loadImagesInBatches();
  }, [groups, mapLoaded, loadGroupImage, updateGeoJSONSource]);

  // Update marker spread when zoom changes
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const mapInstance = map.current;

    const handleZoom = () => {
      updateGeoJSONSource();
    };

    mapInstance.on('zoomend', handleZoom);

    return () => {
      mapInstance.off('zoomend', handleZoom);
    };
  }, [mapLoaded, updateGeoJSONSource]);

  // Update selected layer filters when selection changes
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    // Update selected layer
    map.current.setFilter(
      SELECTED_PHOTO_LAYER,
      selectedGroupId ? ['==', ['get', 'id'], selectedGroupId] : ['==', ['get', 'id'], -1]
    );

    // Hide selected from regular layer
    map.current.setFilter(
      PHOTO_LAYER,
      selectedGroupId ? ['!=', ['get', 'id'], selectedGroupId] : null
    );
  }, [selectedGroupId, mapLoaded]);

  // Calculate groups visible within current map bounds (uses ref for stable reference)
  const getVisibleGroups = useCallback((mapInstance: any): Group[] => {
    if (!mapInstance) return [];

    const bounds = mapInstance.getBounds();
    if (!bounds) return [];

    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();

    return groupsRef.current.filter((group) => {
      if (group.latitude == null || group.longitude == null) return false;
      return (
        group.latitude >= south &&
        group.latitude <= north &&
        group.longitude >= west &&
        group.longitude <= east
      );
    });
  }, []);

  // Notify parent of bounds change (uses ref to avoid re-creating on prop changes)
  const notifyBoundsChange = useCallback(() => {
    if (!map.current || !onBoundsChangeRef.current) return;

    const bounds = map.current.getBounds();
    if (!bounds) return;

    const mapBounds: MapBounds = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };

    const visibleGroups = getVisibleGroups(map.current);
    onBoundsChangeRef.current(mapBounds, visibleGroups);
  }, [getVisibleGroups]);

  // Fit bounds to show all groups (uses ref for stable reference)
  const fitToGroups = useCallback(() => {
    if (!map.current || !mapboxgl) return;

    const groupsWithLocation = groupsRef.current.filter(
      (g) => g.latitude != null && g.longitude != null
    );

    if (groupsWithLocation.length === 0) return;

    if (groupsWithLocation.length === 1) {
      const group = groupsWithLocation[0];
      map.current.flyTo({
        center: [group.longitude!, group.latitude!],
        zoom: 14,
        duration: 1000,
      });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    groupsWithLocation.forEach((group) => {
      bounds.extend([group.longitude!, group.latitude!]);
    });

    map.current.fitBounds(bounds, {
      padding: { top: 50, bottom: 50, left: 50, right: 50 },
      duration: 1000,
    });
  }, []);

  // Fit to groups when they first load or when groups first become available.
  // Uses a ref flag so the auto-fit only happens once per mount.
  const hasFittedRef = useRef(false);
  useEffect(() => {
    if (!mapLoaded || groups.length === 0 || hasFittedRef.current) return;
    hasFittedRef.current = true;
    fitToGroups();
    const timeoutId = setTimeout(() => {
      notifyBoundsChange();
    }, 1100);
    return () => clearTimeout(timeoutId);
  }, [mapLoaded, groups, fitToGroups, notifyBoundsChange]);

  // Resize the web map when its container becomes visible or changes size.
  useEffect(() => {
    if (Platform.OS !== 'web' || !map.current || !mapWrapperRef.current) return;

    const resizeMap = () => {
      if (!map.current) return;
      map.current.resize();
    };

    const rafId = requestAnimationFrame(resizeMap);
    const timeoutId = window.setTimeout(resizeMap, 150);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        resizeMap();
      });
      observer.observe(mapWrapperRef.current);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [mapLoaded, groups.length, selectedGroupId]);

  // Notify bounds change when groups list changes (e.g., from filtering)
  useEffect(() => {
    if (mapLoaded) {
      // Notify immediately when groups change due to filtering
      notifyBoundsChange();
    }
  }, [groups, mapLoaded, notifyBoundsChange]);

  // Center on selected group
  useEffect(() => {
    if (!map.current || !selectedGroupId || !mapLoaded) return;

    const selectedGroup = groups.find((g) => g.id === selectedGroupId);
    if (selectedGroup?.latitude && selectedGroup?.longitude) {
      map.current.flyTo({
        center: [selectedGroup.longitude, selectedGroup.latitude],
        zoom: Math.max(map.current.getZoom(), 14),
        duration: 500,
      });
    }
  }, [selectedGroupId, groups, mapLoaded]);

  // Error state
  if (mapError) {
    return (
      <View style={styles.nativeFallback}>
        <Text style={styles.fallbackText}>Map Configuration Error</Text>
        <Text style={styles.fallbackSubtext}>{mapError}</Text>
      </View>
    );
  }

  // Use native map component on iOS/Android
  if (Platform.OS !== 'web' && ExploreMapNative) {
    return (
      <ExploreMapNative
        groups={groups}
        selectedGroupId={selectedGroupId}
        onGroupSelect={onGroupSelect}
        onBoundsChange={onBoundsChange}
        mapboxToken={mapboxToken}
      />
    );
  }

  return (
    <View style={styles.container}>
      <div
        ref={mapWrapperRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  nativeFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  fallbackText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  fallbackSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});
