/**
 * ExploreMapNative - Native map component for iOS/Android
 *
 * This component uses react-native-maps (Apple Maps on iOS, Google Maps on Android).
 * It provides the same interface as the web ExploreMap component.
 *
 * MIGRATION NOTE: This component is designed to be easily swapped to @rnmapbox/maps
 * when switching to a development build. See /docs/architecture/MAP_MIGRATION.md
 */

import React, { useEffect, useRef, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import { View, StyleSheet, Image, Text } from 'react-native';
import MapView, { Marker, Region, Camera } from 'react-native-maps';
import { Group } from '@features/groups/types';
import { MAP_CONFIG, GROUP_TYPE_COLORS, DEFAULT_GROUP_COLOR } from '../constants';
import type { MapBounds } from './ExploreMap';
import { getMediaUrlWithTransform } from '@/utils/media';

interface ExploreMapNativeProps {
  groups: Group[];
  selectedGroupId: number | null;
  onGroupSelect: (group: Group | null) => void;
  onBoundsChange?: (bounds: MapBounds, visibleGroups: Group[]) => void;
  mapboxToken: string; // Kept for API compatibility, not used with react-native-maps
}

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

// Generate avatar URL with group initials
const getAvatarUrl = (group: Group): string => {
  const initials = getInitials(group.name || group.title);
  const groupTypeId = group.group_type ?? group.type;
  const bgColor = (groupTypeId ? (GROUP_TYPE_COLORS[groupTypeId] || DEFAULT_GROUP_COLOR) : DEFAULT_GROUP_COLOR).replace('#', '');
  return `https://ui-avatars.com/api/?background=${bgColor}&color=fff&name=${encodeURIComponent(initials)}&size=128&format=png`;
};

// Base spread radius in degrees for overlapping markers
const BASE_SPREAD_RADIUS = 0.00012;

// Marker sizes
const MARKER_SIZE = 36;
const BORDER_WIDTH = 3;
const IMAGE_SIZE = MARKER_SIZE - BORDER_WIDTH * 2;

// Individual marker component
const GroupMarker = React.memo(({
  group,
  coords,
  ringColor,
  imageUrl,
  fallbackUrl,
  onPress
}: {
  group: Group;
  coords: { latitude: number; longitude: number };
  ringColor: string;
  imageUrl: string;
  fallbackUrl: string;
  onPress: () => void;
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [showInitials, setShowInitials] = useState(false);

  // Reset state when image URLs change (e.g., after data refresh)
  useLayoutEffect(() => {
    setImageLoaded(false);
    setUseFallback(false);
    setShowInitials(false);
  }, [imageUrl, fallbackUrl]);

  // Get initials for fallback display
  const initials = getInitials(group.name || group.title);

  // Determine which URL to use
  const currentUrl = useFallback ? fallbackUrl : imageUrl;

  const handleError = useCallback(() => {
    if (!useFallback && fallbackUrl && fallbackUrl !== imageUrl) {
      // Try fallback URL
      setUseFallback(true);
    } else {
      // Fallback also failed or not available, show initials
      setShowInitials(true);
      setImageLoaded(true); // Stop tracksViewChanges
    }
  }, [useFallback, fallbackUrl, imageUrl]);

  return (
    <Marker
      key={group.id}
      identifier={String(group.id)}
      coordinate={coords}
      onPress={onPress}
      zIndex={1}
      tracksViewChanges={!imageLoaded}
      stopPropagation={true}
    >
      <View
        style={{
          width: MARKER_SIZE,
          height: MARKER_SIZE,
          borderRadius: MARKER_SIZE / 2,
          borderWidth: BORDER_WIDTH,
          borderColor: ringColor,
          backgroundColor: showInitials ? ringColor : '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {showInitials ? (
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
            {initials}
          </Text>
        ) : (
          <Image
            source={{ uri: currentUrl }}
            style={{
              width: IMAGE_SIZE - 2,
              height: IMAGE_SIZE - 2,
              borderRadius: (IMAGE_SIZE - 2) / 2,
              // Only show grey background while loading, not after
              backgroundColor: imageLoaded ? 'transparent' : '#eee',
            }}
            resizeMode="cover"
            onLoad={() => {
              // Small delay to ensure image is fully composited before freezing marker
              // This fixes Android issue where grey background renders on top of image
              setTimeout(() => setImageLoaded(true), 50);
            }}
            onError={handleError}
          />
        )}
      </View>
    </Marker>
  );
});

export function ExploreMapNative({
  groups,
  selectedGroupId,
  onGroupSelect,
  onBoundsChange,
}: ExploreMapNativeProps) {
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<Region>({
    latitude: MAP_CONFIG.defaultCenter.lat,
    longitude: MAP_CONFIG.defaultCenter.lng,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });

  // Calculate spread coordinates for overlapping markers
  const getSpreadCoordinates = useCallback((group: Group, allGroups: Group[], zoom: number) => {
    if (group.latitude == null || group.longitude == null) {
      return null;
    }

    // Group markers by their coordinates (rounded to detect overlaps)
    const coordPrecision = 5;
    const key = `${group.latitude.toFixed(coordPrecision)},${group.longitude.toFixed(coordPrecision)}`;

    const overlappingGroups = allGroups.filter((g) => {
      if (g.latitude == null || g.longitude == null) return false;
      const gKey = `${g.latitude.toFixed(coordPrecision)},${g.longitude.toFixed(coordPrecision)}`;
      return gKey === key;
    });

    let lng = group.longitude;
    let lat = group.latitude;

    // If there are multiple groups at this location, spread them in a circle
    if (overlappingGroups.length > 1) {
      const index = overlappingGroups.findIndex((g) => g.id === group.id);
      const count = overlappingGroups.length;
      const angle = (2 * Math.PI * index) / count;

      const minZoom = 10;
      const maxZoom = 18;
      const clampedZoom = Math.max(minZoom, Math.min(maxZoom, zoom));
      const zoomProgress = (clampedZoom - minZoom) / (maxZoom - minZoom);
      const spreadMultiplier = 0.3 + Math.pow(zoomProgress, 0.7) * 5.7;
      const geoOffset = BASE_SPREAD_RADIUS * Math.pow(2, 16 - zoom);
      const adjustedRadius = geoOffset * spreadMultiplier;

      lng += Math.cos(angle) * adjustedRadius;
      lat += Math.sin(angle) * adjustedRadius;
    }

    return { latitude: lat, longitude: lng };
  }, []);

  // Estimate zoom level from region
  const getZoomFromRegion = useCallback((region: Region): number => {
    // Approximate zoom calculation from latitudeDelta
    const zoom = Math.log2(360 / region.latitudeDelta);
    return Math.min(Math.max(zoom, MAP_CONFIG.minZoom), MAP_CONFIG.maxZoom);
  }, []);

  // Get visible groups within bounds
  const getVisibleGroups = useCallback((region: Region): Group[] => {
    const north = region.latitude + region.latitudeDelta / 2;
    const south = region.latitude - region.latitudeDelta / 2;
    const east = region.longitude + region.longitudeDelta / 2;
    const west = region.longitude - region.longitudeDelta / 2;

    return groups.filter((group) => {
      if (group.latitude == null || group.longitude == null) return false;
      return (
        group.latitude >= south &&
        group.latitude <= north &&
        group.longitude >= west &&
        group.longitude <= east
      );
    });
  }, [groups]);

  // Handle region change
  const handleRegionChangeComplete = useCallback((region: Region) => {
    setCurrentRegion(region);

    if (onBoundsChange) {
      const mapBounds: MapBounds = {
        north: region.latitude + region.latitudeDelta / 2,
        south: region.latitude - region.latitudeDelta / 2,
        east: region.longitude + region.longitudeDelta / 2,
        west: region.longitude - region.longitudeDelta / 2,
      };
      const visibleGroups = getVisibleGroups(region);
      onBoundsChange(mapBounds, visibleGroups);
    }
  }, [onBoundsChange, getVisibleGroups]);

  // Handle marker press
  const handleMarkerPress = useCallback((group: Group) => {
    console.log('[ExploreMapNative] Marker pressed:', group.id, group.name);
    onGroupSelect(group);
  }, [onGroupSelect]);

  // Handle map press (deselect)
  const handleMapPress = useCallback(() => {
    onGroupSelect(null);
  }, [onGroupSelect]);

  // Fit map to show all groups
  const fitToGroups = useCallback(() => {
    if (!mapRef.current) return;

    const groupsWithLocation = groups.filter(
      (g) => g.latitude != null && g.longitude != null
    );

    if (groupsWithLocation.length === 0) return;

    if (groupsWithLocation.length === 1) {
      const group = groupsWithLocation[0];
      mapRef.current.animateToRegion({
        latitude: group.latitude!,
        longitude: group.longitude!,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }, 1000);
      return;
    }

    // Calculate bounds
    const coordinates = groupsWithLocation.map((g) => ({
      latitude: g.latitude!,
      longitude: g.longitude!,
    }));

    mapRef.current.fitToCoordinates(coordinates, {
      edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
      animated: true,
    });
  }, [groups]);

  // Fit to groups when map loads
  useEffect(() => {
    if (mapReady && groups.length > 0) {
      // Small delay to ensure map is fully ready
      const timer = setTimeout(() => {
        fitToGroups();
      }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, groups.length]);

  // Notify parent when groups change (e.g., due to filtering)
  const notifyBoundsChange = useCallback(() => {
    if (mapReady && onBoundsChange) {
      const visibleGroups = getVisibleGroups(currentRegion);
      const mapBounds: MapBounds = {
        north: currentRegion.latitude + currentRegion.latitudeDelta / 2,
        south: currentRegion.latitude - currentRegion.latitudeDelta / 2,
        east: currentRegion.longitude + currentRegion.longitudeDelta / 2,
        west: currentRegion.longitude - currentRegion.longitudeDelta / 2,
      };
      onBoundsChange(mapBounds, visibleGroups);
    }
  }, [mapReady, onBoundsChange, getVisibleGroups, currentRegion]);

  useEffect(() => {
    notifyBoundsChange();
  }, [groups.length, notifyBoundsChange]);

  // Center on selected group
  useEffect(() => {
    if (!mapRef.current || !selectedGroupId || !mapReady) return;

    const selectedGroup = groups.find((g) => g.id === selectedGroupId);
    if (selectedGroup?.latitude && selectedGroup?.longitude) {
      mapRef.current.animateToRegion({
        latitude: selectedGroup.latitude,
        longitude: selectedGroup.longitude,
        latitudeDelta: Math.min(currentRegion.latitudeDelta, 0.02),
        longitudeDelta: Math.min(currentRegion.longitudeDelta, 0.02),
      }, 500);
    }
  }, [selectedGroupId, groups, mapReady, currentRegion]);

  // Memoize markers - NO selection-dependent styling to avoid react-native-maps rendering bugs
  // Selection is indicated only by the floating card, not marker appearance
  const markers = useMemo(() => {
    const zoom = getZoomFromRegion(currentRegion);
    const groupsWithLocation = groups.filter(
      (g) => g.latitude != null && g.longitude != null
    );

    return groupsWithLocation.map((group) => {
      const coords = getSpreadCoordinates(group, groupsWithLocation, zoom);
      if (!coords) return null;

      const groupTypeId = group.group_type ?? group.type;
      const ringColor = groupTypeId ? (GROUP_TYPE_COLORS[groupTypeId] || DEFAULT_GROUP_COLOR) : DEFAULT_GROUP_COLOR;
      const primaryUrl = group.preview || group.image_url;
      // Fallback to avatar with initials
      const avatarUrl = getAvatarUrl(group);
      // Optimize image for map marker (~80px for tiny markers, high cache hit rate)
      const optimizedUrl = primaryUrl
        ? getMediaUrlWithTransform(primaryUrl, { width: 80, height: 80, fit: 'cover', quality: 80 })
        : avatarUrl;
      const imageUrl = optimizedUrl || avatarUrl;

      return (
        <GroupMarker
          key={group.id}
          group={group}
          coords={coords}
          ringColor={ringColor}
          imageUrl={imageUrl}
          fallbackUrl={avatarUrl}
          onPress={() => handleMarkerPress(group)}
        />
      );
    }).filter(Boolean);
  }, [groups, currentRegion, getSpreadCoordinates, getZoomFromRegion, handleMarkerPress]);

  // Initial camera with 3D tilt
  const initialCamera: Camera = {
    center: {
      latitude: MAP_CONFIG.defaultCenter.lat,
      longitude: MAP_CONFIG.defaultCenter.lng,
    },
    pitch: MAP_CONFIG.pitch,
    heading: MAP_CONFIG.bearing,
    zoom: MAP_CONFIG.defaultZoom,
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialCamera={initialCamera}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPress={handleMapPress}
        showsBuildings={true}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        pitchEnabled={true}
        rotateEnabled={true}
        minZoomLevel={MAP_CONFIG.minZoom}
        maxZoomLevel={MAP_CONFIG.maxZoom}
      >
        {markers}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
