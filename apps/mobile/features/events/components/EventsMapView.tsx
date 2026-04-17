/**
 * EventsMapView
 *
 * Map view for the Events tab. Fetches ALL events happening in the next
 * 7 days via `communityEvents` — which does NOT collapse community-wide
 * events into grouped cards like `listForEventsTab` does. That's what we
 * want here: each per-group child of a community-wide event has its own
 * real location, so they should each get their own marker on the map.
 *
 * - Geocoding priority: event.locationOverride (sync zip → async address)
 *   falls back to the hosting group's address components.
 * - Tapping a marker navigates directly to the event detail route. No
 *   persistent selection state / FloatingGroupCard is rendered.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { ExploreMap } from '@features/explore/components/ExploreMap';
import {
  getGroupCoordinates,
  geocodeAddressAsync,
} from '@features/groups/utils/geocodeLocation';
import { Group } from '@features/groups/types';
import { useTheme } from '@hooks/useTheme';
import { useCommunityEvents } from '../hooks/useCommunityEvents';

// Mapbox token — match GroupsScreen's source exactly.
const mapboxToken =
  Constants.expoConfig?.extra?.mapboxAccessToken ||
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
  '';

type EventMarker = Group & { _isEvent: true; _eventShortId: string };

interface EventsMapViewProps {
  /**
   * When false, the map view skips fetching. Used so the query doesn't
   * fire in list mode — this component stays mounted across toggle but
   * only needs data when it's actually rendered.
   */
  enabled?: boolean;
}

/**
 * Hash a string id into a positive 32-bit int. Used when the event's
 * Convex id has no parseable numeric form. Matches the old ExploreScreen
 * fallback so marker ids remain stable per event.
 */
function hashToInt(id: string): number {
  return Math.abs(
    id.split('').reduce<number>(
      (acc, ch) => ((acc << 5) - acc) + ch.charCodeAt(0),
      0
    )
  );
}

export function EventsMapView({ enabled = true }: EventsMapViewProps) {
  const router = useRouter();
  const { colors } = useTheme();

  // Fetch every event in the next 7 days (no CWE collapsing — each
  // per-group child of a community-wide event needs its own marker).
  // `communityEvents` already filters by visibility server-side.
  const { data, isLoading } = useCommunityEvents(
    {
      dateFilter: 'this_week',
      startDate: undefined,
      endDate: undefined,
      hostingGroups: [],
    },
    { enabled }
  );

  const singleEvents = useMemo(() => {
    const events = (data?.events ?? []) as any[];
    const seen = new Set<string>();
    const result: any[] = [];
    for (const event of events) {
      const id = String(event.id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(event);
    }
    return result;
  }, [data?.events]);

  // Geocode events → markers. Stable empty ref to avoid re-render loops
  // when the input is empty (see ExploreScreen pattern).
  const emptyMarkersRef = useRef<EventMarker[]>([]);
  const [markers, setMarkers] = useState<EventMarker[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);

  useEffect(() => {
    if (singleEvents.length === 0) {
      setMarkers((prev) =>
        prev.length === 0 ? prev : emptyMarkersRef.current
      );
      setIsGeocoding(false);
      return;
    }

    let cancelled = false;
    setIsGeocoding(true);

    async function geocodeEvents() {
      const out: EventMarker[] = [];

      for (const event of singleEvents) {
        if (cancelled) return;

        let coords = null;

        // Priority 1: event's own locationOverride (event-specific venue).
        if (event.locationOverride) {
          coords = getGroupCoordinates({
            location: event.locationOverride,
          } as any);
          if (!coords) {
            coords = await geocodeAddressAsync(event.locationOverride);
          }
        }

        // Priority 2: hosting group's address components.
        if (!coords) {
          coords = getGroupCoordinates({
            address_line1: event.group.addressLine1,
            address_line2: event.group.addressLine2,
            city: event.group.city,
            state: event.group.state,
            zip_code: event.group.zipCode,
          } as any);
        }

        if (!coords) continue;

        const eventImageUrl =
          event.coverImage || event.group?.image || null;
        const idStr = String(event.id);
        const numericId = parseInt(idStr, 10);

        out.push({
          _id: idStr,
          id: Number.isFinite(numericId) ? numericId : hashToInt(idStr),
          uuid: idStr,
          name: event.title || event.group.name,
          title: event.title || event.group.name,
          preview: eventImageUrl,
          image_url: eventImageUrl,
          group_type_name: event.group.groupTypeName,
          latitude: coords.latitude,
          longitude: coords.longitude,
          _isEvent: true,
          _eventShortId: event.shortId || idStr,
        } as EventMarker);
      }

      if (!cancelled) {
        setMarkers(out);
        setIsGeocoding(false);
      }
    }

    geocodeEvents();

    return () => {
      cancelled = true;
    };
  }, [singleEvents]);

  const handleGroupSelect = (group: Group | null) => {
    if (!group) return;
    const marker = group as Partial<EventMarker>;
    if (marker._isEvent && marker._eventShortId) {
      router.push(`/e/${marker._eventShortId}?source=app`);
    }
  };

  // Don't render the map with an empty list — it initializes oddly.
  // Show a spinner while loading or geocoding.
  if (isLoading || isGeocoding || markers.length === 0) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: colors.backgroundSecondary },
        ]}
      >
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ExploreMap
        groups={markers}
        selectedGroupId={null}
        onGroupSelect={handleGroupSelect}
        mapboxToken={mapboxToken}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
