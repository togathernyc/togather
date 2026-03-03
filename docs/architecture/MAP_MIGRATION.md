# Map Implementation Migration Guide

## Current State: react-native-maps

The mobile app currently uses `react-native-maps` for native iOS/Android map rendering. This library:
- Works in Expo Go (no development build required)
- Uses Apple Maps on iOS, Google Maps on Android
- Supports 3D buildings with camera pitch
- Supports custom markers with images

## Future Migration: @rnmapbox/maps

When ready to switch to Mapbox for native maps (to match the web implementation), follow this guide.

### Why Migrate to Mapbox?

- Consistent styling across web and mobile (same Mapbox tiles)
- Better 3D building control
- Custom map styles
- More advanced features (terrain, globe view, etc.)

### Prerequisites

1. **Development Build Required**: @rnmapbox/maps will NOT work in Expo Go
2. **Mapbox Account**: You need a Mapbox access token
3. **Download Token**: For EAS builds, you need a secret download token

### Migration Steps

#### Step 1: Update app.json

Add the Mapbox plugin:

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      "expo-web-browser",
      [
        "@rnmapbox/maps",
        {
          "RNMapboxMapsDownloadToken": "YOUR_SECRET_DOWNLOAD_TOKEN"
        }
      ]
    ]
  }
}
```

For EAS builds, use environment variables instead:
```json
{
  "RNMapboxMapsDownloadToken": "$(MAPBOX_DOWNLOAD_TOKEN)"
}
```

#### Step 2: Replace ExploreMapNative.tsx

Replace the current `react-native-maps` implementation with @rnmapbox/maps.

**File:** `apps/mobile/features/explore/components/ExploreMapNative.tsx`

```tsx
/**
 * ExploreMapNative - Native map component using Mapbox
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Mapbox, { Camera, MapView, ShapeSource, SymbolLayer, Images } from '@rnmapbox/maps';
import { DinnerGroup } from '@features/groups/types';
import { MAP_CONFIG, GROUP_TYPE_COLORS, DEFAULT_GROUP_COLOR } from '../constants';
import type { MapBounds } from './ExploreMap';

interface ExploreMapNativeProps {
  groups: DinnerGroup[];
  selectedGroupId: number | null;
  onGroupSelect: (group: DinnerGroup | null) => void;
  onBoundsChange?: (bounds: MapBounds, visibleGroups: DinnerGroup[]) => void;
  mapboxToken: string;
}

const DEFAULT_GROUP_IMAGE = 'https://ui-avatars.com/api/?background=8C10FE&color=fff&name=G&size=128&format=png';
const SOURCE_ID = 'groups-source';
const MARKER_LAYER = 'group-markers';
const SELECTED_LAYER = 'selected-marker';

export function ExploreMapNative({
  groups,
  selectedGroupId,
  onGroupSelect,
  onBoundsChange,
  mapboxToken,
}: ExploreMapNativeProps) {
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize Mapbox access token
  useEffect(() => {
    if (mapboxToken) {
      Mapbox.setAccessToken(mapboxToken);
    }
  }, [mapboxToken]);

  // Convert groups to GeoJSON
  const geoJSON = useMemo(() => {
    const features = groups
      .filter((g) => g.latitude != null && g.longitude != null)
      .map((group) => ({
        type: 'Feature' as const,
        id: group.id.toString(),
        geometry: {
          type: 'Point' as const,
          coordinates: [group.longitude!, group.latitude!],
        },
        properties: {
          id: group.id,
          name: group.name,
          isSelected: group.id === selectedGroupId,
        },
      }));

    return { type: 'FeatureCollection' as const, features };
  }, [groups, selectedGroupId]);

  // Build images object
  const images: { [key: string]: string } = {};
  groups.forEach((group) => {
    const imageUrl = group.preview || group.image_url || DEFAULT_GROUP_IMAGE;
    images[`group-${group.id}`] = imageUrl;
  });

  // Handle marker press
  const handleMarkerPress = useCallback((event: any) => {
    const feature = event.features?.[0];
    if (feature?.properties?.id) {
      const group = groups.find((g) => g.id === feature.properties.id);
      if (group) onGroupSelect(group);
    }
  }, [groups, onGroupSelect]);

  // Handle bounds change
  const handleRegionDidChange = useCallback(async () => {
    if (!mapRef.current || !onBoundsChange) return;
    try {
      const bounds = await mapRef.current.getVisibleBounds();
      if (bounds) {
        const mapBounds: MapBounds = {
          north: bounds[0][1],
          south: bounds[1][1],
          east: bounds[0][0],
          west: bounds[1][0],
        };
        const visibleGroups = groups.filter((g) => {
          if (g.latitude == null || g.longitude == null) return false;
          return (
            g.latitude >= mapBounds.south &&
            g.latitude <= mapBounds.north &&
            g.longitude >= mapBounds.west &&
            g.longitude <= mapBounds.east
          );
        });
        onBoundsChange(mapBounds, visibleGroups);
      }
    } catch (error) {
      console.warn('Failed to get map bounds:', error);
    }
  }, [groups, onBoundsChange]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        styleURL="mapbox://styles/mapbox/standard"
        onDidFinishLoadingMap={() => setMapReady(true)}
        onRegionDidChange={handleRegionDidChange}
        onPress={() => onGroupSelect(null)}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [MAP_CONFIG.defaultCenter.lng, MAP_CONFIG.defaultCenter.lat],
            zoomLevel: MAP_CONFIG.defaultZoom,
            pitch: MAP_CONFIG.pitch,
          }}
        />

        {mapReady && (
          <>
            <Images images={images} />
            <ShapeSource
              id={SOURCE_ID}
              shape={geoJSON as any}
              onPress={handleMarkerPress}
            >
              <SymbolLayer
                id={MARKER_LAYER}
                filter={['!=', ['get', 'isSelected'], true]}
                style={{
                  iconImage: ['concat', 'group-', ['to-string', ['get', 'id']]],
                  iconSize: 0.4,
                  iconAllowOverlap: true,
                }}
              />
              <SymbolLayer
                id={SELECTED_LAYER}
                filter={['==', ['get', 'isSelected'], true]}
                style={{
                  iconImage: ['concat', 'group-', ['to-string', ['get', 'id']]],
                  iconSize: 0.6,
                  iconAllowOverlap: true,
                }}
              />
            </ShapeSource>
          </>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
```

#### Step 3: Create Development Build

```bash
# Install EAS CLI if not already installed
npm install -g eas-cli

# Login to Expo
eas login

# Create development build for iOS
eas build --profile development --platform ios

# Create development build for Android
eas build --profile development --platform android
```

#### Step 4: Update eas.json

Add development profile if not present:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "MAPBOX_DOWNLOAD_TOKEN": "your-secret-token"
      }
    }
  }
}
```

#### Step 5: Run with Development Client

```bash
# Start the development server
npx expo start --dev-client

# Scan QR code with the development build app (not Expo Go)
```

### Key Differences Between Libraries

| Feature | react-native-maps | @rnmapbox/maps |
|---------|------------------|----------------|
| Expo Go Support | Yes | No (dev build required) |
| Map Tiles | Apple/Google | Mapbox |
| 3D Buildings | Via pitch | Full control |
| Custom Styles | Limited | Full Mapbox styles |
| Marker Rendering | React components | GeoJSON + Layers |
| Performance | Good | Better for many markers |

### Files to Modify

1. `apps/mobile/app.json` - Add Mapbox plugin
2. `apps/mobile/features/explore/components/ExploreMapNative.tsx` - Replace implementation
3. `apps/mobile/eas.json` - Add development profile with tokens

### Environment Variables Needed

- `EXPO_PUBLIC_MAPBOX_TOKEN` - Public access token (already exists)
- `MAPBOX_DOWNLOAD_TOKEN` - Secret token for downloading Mapbox SDK (EAS builds)

### Rollback

To rollback to react-native-maps:
1. Remove @rnmapbox/maps from app.json plugins
2. Revert ExploreMapNative.tsx to react-native-maps implementation
3. Can use Expo Go again without development build

### Related Files

- `apps/mobile/features/explore/components/ExploreMap.tsx` - Web implementation (uses maplibre-gl)
- `apps/mobile/features/explore/components/ExploreMapNative.tsx` - Native implementation
- `apps/mobile/features/explore/constants.ts` - Shared map configuration
