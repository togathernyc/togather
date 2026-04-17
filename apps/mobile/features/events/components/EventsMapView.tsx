/**
 * EventsMapView
 *
 * Map view for the Events tab. Renders events from all four buckets
 * (happeningNow + myRsvps + thisWeek + later) as markers on ExploreMap.
 *
 * - Community-wide grouped cards (kind !== 'single') are filtered out —
 *   they have no single location of their own.
 * - Events are de-duped by id across buckets.
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

// Mapbox token — match GroupsScreen's source exactly.
const mapboxToken =
  Constants.expoConfig?.extra?.mapboxAccessToken ||
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
  '';

type EventMarker = Group & { _isEvent: true; _eventShortId: string };

interface EventsMapViewProps {
  /**
   * Cards from all four Events-tab buckets, already flattened.
   * Community-wide grouped cards are filtered out inside this component.
   */
  cards: any[];
  /** True while the events query is still loading. */
  isLoading: boolean;
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

export function EventsMapView({ cards, isLoading }: EventsMapViewProps) {
  const router = useRouter();
  const { colors } = useTheme();

  // Flatten + de-dupe + drop community-wide grouped cards.
  // Community-wide cards have kind === 'community_wide' and no per-card
  // location — they collapse multiple per-group instances into one card.
  const singleEvents = useMemo(() => {
    const seen = new Set<string>();
    const result: any[] = [];
    for (const card of cards) {
      if (!card || card.kind !== 'single') continue;
      const id = String(card.id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(card);
    }
    return result;
  }, [cards]);

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
